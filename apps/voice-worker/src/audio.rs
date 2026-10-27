//! Audio input construction.
//!
//! Two strategies, selected by `AUDIO_DECODER`:
//!
//! * `inprocess` (default): download to the cache, then hand the file to
//!   songbird, which decodes it with symphonia inside this process. No
//!   decoder child process exists during playback.
//! * `ffmpeg`: spawn ffmpeg per track and feed its output through
//!   songbird's `ChildContainer`. Kept as a fallback for formats symphonia
//!   cannot demux.

use songbird::input::{ChildContainer, File, Input};
use std::process::Stdio;

use crate::cache::TrackCache;
use crate::model::{FilterPreset, Track};
use crate::resolve::Resolver;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeMode {
    InProcess,
    Ffmpeg,
}

impl DecodeMode {
    pub fn from_env() -> Self {
        match std::env::var("AUDIO_DECODER").unwrap_or_default().as_str() {
            "ffmpeg" => Self::Ffmpeg,
            _ => Self::InProcess,
        }
    }
}

#[derive(Clone)]
pub struct AudioConfig {
    pub mode: DecodeMode,
    pub ffmpeg_path: String,
    pub cache: TrackCache,
    pub resolver: Resolver,
}

impl AudioConfig {
    /// Filter expression for ffmpeg, mirroring `GuildPlayer::audioFilter`.
    fn filter_args(preset: FilterPreset) -> Vec<String> {
        match preset.ffmpeg_filter() {
            Some(filter) => vec!["-af".into(), filter.into()],
            None => Vec::new(),
        }
    }

    /// In-process path: cache the track, then let symphonia decode the file.
    async fn file_input(
        &self,
        track: &Track,
        start_ms: i64,
        preset: FilterPreset,
    ) -> Result<Input, InputError> {
        let path = self.cache.ensure(track).await.map_err(InputError::Resolve)?;

        // A filter or a seek needs re-encoding, so it goes through ffmpeg.
        if preset != FilterPreset::Off || start_ms > 0 {
            return self.ffmpeg_input(&path.to_string_lossy(), start_ms, preset);
        }

        Ok(File::new(path).into())
    }

    /// ffmpeg path: WAV keeps symphonia's job trivial and avoids raw PCM framing.
    fn ffmpeg_input(
        &self,
        source: &str,
        start_ms: i64,
        preset: FilterPreset,
    ) -> Result<Input, InputError> {
        let mut args: Vec<String> = vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
        ];
        if start_ms > 0 {
            args.extend(["-ss".into(), format!("{:.3}", start_ms as f64 / 1000.0)]);
        }
        args.extend(["-i".into(), source.to_string()]);
        args.extend(Self::filter_args(preset));
        args.extend([
            "-f".into(),
            "wav".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            "pipe:1".into(),
        ]);

        let child = std::process::Command::new(&self.ffmpeg_path)
            .args(&args)
            .current_dir("/tmp")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| InputError::Decode(format!("ffmpeg failed to start: {error}")))?;

        Ok(ChildContainer::from(child).into())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    #[error("{0}")]
    Resolve(String),
    #[error("{0}")]
    Decode(String),
}

impl From<InputError> for crate::player::PlayerError {
    fn from(error: InputError) -> Self {
        match error {
            InputError::Resolve(message) => Self::Internal(message),
            InputError::Decode(message) => Self::Internal(message),
        }
    }
}

pub async fn build_input(
    track: &Track,
    start_ms: i64,
    preset: FilterPreset,
    config: &AudioConfig,
) -> Result<Input, crate::player::PlayerError> {
    match config.mode {
        DecodeMode::InProcess => {
            // Live streams cannot be cached, so they always go through ffmpeg.
            if track.is_stream {
                let url = config
                    .resolver
                    .direct_url(&track.url)
                    .await
                    .map_err(|error| crate::player::PlayerError::Internal(error.to_string()))?;
                return config
                    .ffmpeg_input(&url, start_ms, preset)
                    .map_err(Into::into);
            }
            config
                .file_input(track, start_ms, preset)
                .await
                .map_err(Into::into)
        }
        DecodeMode::Ffmpeg => {
            let url = config
                .resolver
                .direct_url(&track.url)
                .await
                .map_err(|error| crate::player::PlayerError::Internal(error.to_string()))?;
            config
                .ffmpeg_input(&url, start_ms, preset)
                .map_err(Into::into)
        }
    }
}
