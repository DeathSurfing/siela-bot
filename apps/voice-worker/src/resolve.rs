//! yt-dlp resolution.
//!
//! Ports `MusicService::resolve`, `searchTracks`, and `directAudioUrl` from
//! `apps/bot/src/features/music.ts`. yt-dlp stays a subprocess: it is the
//! extractor, and replacing it is a separate problem from decoding audio.

use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

use crate::model::Track;

/// Same format string the TypeScript bot uses.
const AUDIO_FORMAT: &str = "bestaudio[abr<=312]/bestaudio/best[abr<=312]/best";
const MAX_QUERY: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("music search failed, try again in a moment")]
    Unavailable,
    #[error("no tracks found for that search")]
    NoTracks,
    #[error("{0}")]
    Invalid(String),
}

pub struct Resolver {
    ytdlp_path: String,
}

impl Clone for Resolver {
    fn clone(&self) -> Self {
        Self {
            ytdlp_path: self.ytdlp_path.clone(),
        }
    }
}

impl Resolver {
    pub fn new(ytdlp_path: impl Into<String>) -> Self {
        Self {
            ytdlp_path: ytdlp_path.into(),
        }
    }

    async fn run(&self, args: &[String], timeout_secs: u64) -> Result<String, ResolveError> {
        let mut command = Command::new(&self.ytdlp_path);
        command
            .args(args)
            .current_dir("/tmp")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            command.output(),
        )
        .await
        .map_err(|_| ResolveError::Unavailable)?
        .map_err(|_| ResolveError::Unavailable)?;

        if !output.status.success() {
            return Err(ResolveError::Unavailable);
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Resolve a query or URL into one or more tracks.
    pub async fn resolve(&self, query: &str, limit: usize) -> Result<Vec<Track>, ResolveError> {
        let target = query.trim().trim_matches(['"', '\'']).trim().to_string();
        if target.is_empty() {
            return Err(ResolveError::Invalid("Provide a search query or URL.".into()));
        }
        if target.len() > MAX_QUERY {
            return Err(ResolveError::Invalid("That query is too long.".into()));
        }

        let is_url = target.starts_with("http://") || target.starts_with("https://");
        let is_playlist = is_url && is_playlist_url(&target);

        let mut args: Vec<String> = vec![
            "--dump-single-json".into(),
            "--no-warnings".into(),
            "--quiet".into(),
            "--js-runtimes".into(),
            "node".into(),
            "--no-part".into(),
            "--no-cache-dir".into(),
        ];

        if is_playlist {
            args.extend([
                "--flat-playlist".into(),
                "--yes-playlist".into(),
                "--playlist-end".into(),
                limit.clamp(1, 500).to_string(),
                target.clone(),
            ]);
        } else {
            args.extend([
                "--no-playlist".into(),
                "--playlist-end".into(),
                limit.clamp(1, 10).to_string(),
                "--default-search".into(),
                "ytsearch".into(),
                target.clone(),
            ]);
        }

        let stdout = self.run(&args, 120).await?;
        let tracks = parse_json_output(&stdout, is_playlist)?;
        if tracks.is_empty() {
            return Err(ResolveError::NoTracks);
        }
        Ok(tracks)
    }

    /// Resolve a direct audio URL for a track, the way `directAudioUrl` does.
    pub async fn direct_url(&self, track_url: &str) -> Result<String, ResolveError> {
        let args: Vec<String> = vec![
            "--js-runtimes".into(),
            "node".into(),
            "--no-part".into(),
            "--no-cache-dir".into(),
            "-g".into(),
            "-f".into(),
            AUDIO_FORMAT.into(),
            "--no-playlist".into(),
            "--no-warnings".into(),
            "--quiet".into(),
            track_url.to_string(),
        ];
        let stdout = self.run(&args, 30).await?;
        stdout
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("http://") || line.starts_with("https://"))
            .map(str::to_string)
            .ok_or(ResolveError::Unavailable)
    }
}

pub fn is_playlist_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("list=") || lower.contains("/playlist")
}

fn parse_json_output(stdout: &str, playlist: bool) -> Result<Vec<Track>, ResolveError> {
    let parsed: Value = serde_json::from_str(stdout.trim())
        .map_err(|_| ResolveError::Invalid("No tracks found for that search.".into()))?;

    let entries: Vec<&Value> = match parsed.get("entries").and_then(Value::as_array) {
        Some(entries) => entries.iter().collect(),
        None => vec![&parsed],
    };

    let mut tracks = Vec::new();
    for entry in entries {
        let url = entry
            .get("webpage_url")
            .or_else(|| entry.get("url"))
            .and_then(Value::as_str);
        let Some(url) = url else { continue };
        if !url.starts_with("http") {
            continue;
        }
        tracks.push(Track {
            url: url.to_string(),
            title: entry
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Unknown title")
                .to_string(),
            author: entry
                .get("uploader")
                .or_else(|| entry.get("channel"))
                .or_else(|| entry.get("artist"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown artist")
                .to_string(),
            length: entry
                .get("duration")
                .and_then(Value::as_f64)
                .map(|seconds| (seconds * 1000.0) as i64)
                .unwrap_or(0),
            is_stream: entry
                .get("is_live")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            artwork_url: entry
                .get("thumbnail")
                .and_then(Value::as_str)
                .map(str::to_string),
        });
        if !playlist {
            break;
        }
    }
    Ok(tracks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_playlist_urls() {
        assert!(is_playlist_url(
            "https://music.youtube.com/playlist?list=PL123"
        ));
        assert!(is_playlist_url("https://youtu.be/watch?v=x&list=PL1"));
        assert!(!is_playlist_url("https://youtu.be/watch?v=x"));
    }

    #[test]
    fn parses_single_video_json() {
        let raw = r#"{"webpage_url":"https://example.com/a","title":"Song","uploader":"Artist","duration":215.4,"is_live":false,"thumbnail":"https://img"}"#;
        let tracks = parse_json_output(raw, false).expect("parse");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "Song");
        assert_eq!(tracks[0].length, 215_400);
    }

    #[test]
    fn parses_playlist_entries() {
        let raw = r#"{"entries":[{"webpage_url":"https://e/1","title":"A"},{"webpage_url":"https://e/2","title":"B"}]}"#;
        let tracks = parse_json_output(raw, true).expect("parse");
        assert_eq!(tracks.len(), 2);
    }
}
