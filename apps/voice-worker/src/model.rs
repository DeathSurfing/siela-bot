//! Domain types for the voice worker.
//!
//! Mirrors the shapes in `packages/shared/src/schemas.ts` so the Rust worker is
//! a drop-in replacement behind the existing router and control API.

use serde::{Deserialize, Serialize};

/// One resolved track, as `MusicTrackInfo` in the TypeScript bot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Track {
    pub url: String,
    pub title: String,
    pub author: String,
    /// Duration in milliseconds. Zero means unknown or live.
    pub length: i64,
    #[serde(rename = "isStream")]
    pub is_stream: bool,
    #[serde(rename = "artworkUrl")]
    pub artwork_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LoopMode {
    #[default]
    Off,
    Track,
    Queue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FilterPreset {
    #[default]
    Off,
    Bassboost,
    Nightcore,
    Vaporwave,
}

impl FilterPreset {
    /// ffmpeg audio filter string, matching `GuildPlayer::audioFilter`.
    pub fn ffmpeg_filter(self) -> Option<&'static str> {
        match self {
            Self::Off => None,
            Self::Bassboost => Some("bass=g=6"),
            Self::Nightcore => Some("asetrate=48000*1.2,aresample=48000"),
            Self::Vaporwave => Some("asetrate=48000*0.8,aresample=48000"),
        }
    }
}

/// Playback state as `GET /internal/music/state` returns it.
#[derive(Debug, Clone, Serialize, Default)]
pub struct MusicState {
    pub playing: bool,
    pub paused: bool,
    pub volume: u8,
    pub r#loop: LoopMode,
    pub position: i64,
    pub current: Option<Track>,
    pub upcoming: Vec<Track>,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
}

/// TTS session state as `GET /internal/tts/state` returns it.
#[derive(Debug, Clone, Serialize, Default)]
pub struct TtsState {
    pub enabled: bool,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
    #[serde(rename = "nodeId")]
    pub node_id: Option<String>,
}
