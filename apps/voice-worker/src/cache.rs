//! On-disk audio cache.
//!
//! Ports `cachedFile`, `ensureCached`, and `pruneCache` from
//! `apps/bot/src/features/music.ts`. The cache matters for the Rust worker:
//! a cached file can be decoded in process, so playback never spawns a
//! decoder.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use sha1::{Digest, Sha1};
use tokio::process::Command;

use crate::model::Track;

const AUDIO_FORMAT: &str = "bestaudio[abr<=312]/bestaudio/best[abr<=312]/best";
const CACHE_DIR: &str = "/tmp/siela-music-cache";
const CACHE_MAX_FILES: usize = 8;
const CACHE_MAX_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Clone)]
pub struct TrackCache {
    dir: PathBuf,
    ytdlp_path: String,
}

impl TrackCache {
    pub fn new(ytdlp_path: impl Into<String>) -> Self {
        let dir = PathBuf::from(CACHE_DIR);
        let _ = std::fs::create_dir_all(&dir);
        Self {
            dir,
            ytdlp_path: ytdlp_path.into(),
        }
    }

    fn key(track: &Track) -> String {
        let mut hasher = Sha1::new();
        hasher.update(track.url.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Existing cache entry for a track, touched so pruning keeps it.
    pub fn lookup(&self, track: &Track) -> Option<PathBuf> {
        if track.is_stream {
            return None;
        }
        let key = Self::key(track);
        let entries = std::fs::read_dir(&self.dir).ok()?;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with(&key) || name.ends_with(".part") {
                continue;
            }
            let path = entry.path();
            if std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
                let _ = filetime_touch(&path);
                return Some(path);
            }
        }
        None
    }

    /// Download a track into the cache. HLS sources are downloaded whole by
    /// yt-dlp, which is what lets playback avoid a decoder process.
    pub async fn ensure(&self, track: &Track) -> Result<PathBuf, String> {
        if track.is_stream {
            return Err("Live streams are not cached.".into());
        }
        if let Some(path) = self.lookup(track) {
            return Ok(path);
        }

        let key = Self::key(track);
        let output = self.dir.join(format!("{key}.%(ext)s"));
        let result = Command::new(&self.ytdlp_path)
            .args([
                "--js-runtimes",
                "node",
                "--no-part",
                "--no-cache-dir",
                "-f",
                AUDIO_FORMAT,
                "-o",
                &output.to_string_lossy(),
                "--no-playlist",
                "--no-warnings",
                "--quiet",
                "--max-filesize",
                "80M",
                "--print",
                "after_move:filepath",
                &track.url,
            ])
            .current_dir(&self.dir)
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|error| format!("yt-dlp failed to start: {error}"))?;

        if !result.status.success() {
            return Err(format!(
                "yt-dlp could not download {}: {}",
                track.title,
                String::from_utf8_lossy(&result.stderr).trim()
            ));
        }

        if let Some(path) = self.lookup(track) {
            self.prune();
            return Ok(path);
        }
        Err(format!("download produced no file for {}", track.title))
    }

    /// Keep the newest few files under the size cap.
    pub fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".part") {
                    return None;
                }
                let meta = entry.metadata().ok()?;
                if !meta.is_file() {
                    return None;
                }
                Some((entry.path(), meta.modified().ok()?, meta.len()))
            })
            .collect();

        files.sort_by_key(|(_, modified, _)| std::cmp::Reverse(*modified));

        let mut kept = 0usize;
        let mut total = 0u64;
        for (path, _, size) in files {
            if kept >= CACHE_MAX_FILES || total + size > CACHE_MAX_BYTES {
                let _ = std::fs::remove_file(path);
                continue;
            }
            kept += 1;
            total += size;
        }
    }
}

fn filetime_touch(path: &Path) -> std::io::Result<()> {
    // Opening with write access and closing updates mtime without changing data.
    let file = std::fs::OpenOptions::new().write(true).open(path)?;
    drop(file);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(url: &str) -> Track {
        Track {
            url: url.into(),
            title: "t".into(),
            author: "a".into(),
            length: 1,
            is_stream: false,
            artwork_url: None,
        }
    }

    #[test]
    fn cache_key_is_stable_and_distinct() {
        let a = TrackCache::key(&track("https://example.com/a"));
        let b = TrackCache::key(&track("https://example.com/a"));
        let c = TrackCache::key(&track("https://example.com/b"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 40);
    }

    #[test]
    fn streams_are_never_cached() {
        let cache = TrackCache::new("yt-dlp");
        let mut live = track("https://example.com/live");
        live.is_stream = true;
        assert!(cache.lookup(&live).is_none());
    }
}
