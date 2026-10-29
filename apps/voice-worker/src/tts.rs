//! Sticky TTS session.
//!
//! Ports `TtsService` and the remote-synthesis path of `TambolaVoice`.
//! Synthesis stays on the shared KittenTTS service; this module owns the
//! session, the idle timer, the clip cache, and playback.
//!
//! The service returns 16-bit PCM WAV from `POST /synthesize`, so the clip is
//! written to disk and played through songbird's file source.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

use crate::model::TtsState;
use crate::player::{PlayerError, PlayerHandle};

/// Session ends after this long with nothing spoken, matching `TTS_IDLE_MS`.
pub const TTS_IDLE_MS: u64 = 30_000;
const IDLE_POLL_MS: u64 = 5_000;
const CACHE_DIR: &str = "/tmp/siela-worker-tts";
const MAX_CACHE_FILES: usize = 300;
const DEFAULT_VOICE: &str = "Bruno";

struct Session {
    channel_id: String,
    node_id: String,
    enabled: bool,
}

struct Inner {
    session: Option<Session>,
    last_activity: Instant,
}

#[derive(Clone)]
pub struct TtsHandle {
    inner: Arc<Mutex<Inner>>,
    node_id: Arc<String>,
    service_url: Option<Arc<String>>,
    voice: Arc<String>,
    cache_dir: PathBuf,
    player: PlayerHandle,
    http: reqwest::Client,
}

impl TtsHandle {
    pub fn new(node_id: impl Into<String>, service_url: Option<String>, player: PlayerHandle) -> Self {
        let cache_dir = PathBuf::from(CACHE_DIR);
        let _ = std::fs::create_dir_all(&cache_dir);

        let handle = Self {
            inner: Arc::new(Mutex::new(Inner {
                session: None,
                last_activity: Instant::now(),
            })),
            node_id: Arc::new(node_id.into()),
            service_url: service_url.map(Arc::new),
            voice: Arc::new(std::env::var("TTS_VOICE").unwrap_or_else(|_| DEFAULT_VOICE.into())),
            cache_dir,
            player,
            http: reqwest::Client::new(),
        };

        // Idle sessions drop themselves so a worker never sits in voice forever.
        let watchdog = handle.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(IDLE_POLL_MS)).await;
                let expired = {
                    let inner = watchdog.inner.lock().await;
                    inner
                        .session
                        .as_ref()
                        .map(|session| session.enabled)
                        .unwrap_or(false)
                        && inner.last_activity.elapsed() >= Duration::from_millis(TTS_IDLE_MS)
                };
                if expired {
                    if let Err(error) = watchdog.disable().await {
                        tracing::warn!(%error, "TTS idle disable failed");
                    } else {
                        tracing::info!("TTS session idle, disabled");
                    }
                }
            }
        });

        handle
    }

    pub async fn state(&self) -> TtsState {
        let inner = self.inner.lock().await;
        match inner.session.as_ref() {
            Some(session) => TtsState {
                enabled: session.enabled,
                channel_id: Some(session.channel_id.clone()),
                node_id: Some(session.node_id.clone()),
            },
            None => TtsState::default(),
        }
    }

    pub async fn enable(&self, channel_id: String) -> Result<(), PlayerError> {
        // One voice connection per bot per guild. When music is already
        // playing, TTS shares that channel instead of moving the bot and
        // cutting the music off. A request for any other channel is refused
        // rather than silently speaking in the wrong one.
        let target = match self.player.current_channel().await {
            Some(current) if current != channel_id => {
                return Err(PlayerError::Invalid(
                    "TTS must share the node's current voice channel.".into(),
                ));
            }
            Some(current) => current,
            None => channel_id,
        };
        self.player.join(Some(target.clone())).await?;
        // Music keeps playing; TTS clips are mixed on top of it.
        self.player.lock_tts().await?;

        let mut inner = self.inner.lock().await;
        inner.session = Some(Session {
            channel_id: target,
            node_id: (*self.node_id).clone(),
            enabled: true,
        });
        inner.last_activity = Instant::now();
        drop(inner);

        // Load the model so the first utterance does not wait on it.
        self.warmup().await;
        Ok(())
    }

    pub async fn disable(&self) -> Result<(), PlayerError> {
        {
            let mut inner = self.inner.lock().await;
            inner.session = None;
        }
        self.player.unlock_tts().await
    }

    /// Synthesize a clip and play it on the current voice connection.
    pub async fn speak(
        &self,
        utterance: String,
        _speaker_id: Option<String>,
    ) -> Result<(), PlayerError> {
        let channel = {
            let inner = self.inner.lock().await;
            match inner.session.as_ref() {
                Some(session) if session.enabled => Some(session.channel_id.clone()),
                _ => None,
            }
        };
        let Some(channel) = channel else {
            // A 200 with no audio would leave the commander believing TTS is
            // on forever. Tell it the session is gone so it can reset.
            return Err(PlayerError::TtsDisabled);
        };
        self.touch().await;

        // Music may have disconnected while the TTS session stayed open.
        // Rejoin the session channel so speech keeps working.
        if self.player.current_channel().await.is_none() {
            self.player.join(Some(channel)).await?;
        }

        let path = self.clip(&utterance).await?;
        self.player
            .play_file(path.to_string_lossy().to_string())
            .await
    }

    async fn touch(&self) {
        self.inner.lock().await.last_activity = Instant::now();
    }

    /// Return a cached WAV for this utterance, synthesizing on a miss.
    async fn clip(&self, text: &str) -> Result<PathBuf, PlayerError> {
        let key = {
            let mut hasher = Sha1::new();
            hasher.update(self.voice.as_bytes());
            hasher.update([0u8]);
            hasher.update(text.as_bytes());
            format!("{:x}", hasher.finalize())
        };
        let path = self.cache_dir.join(format!("{key}.wav"));

        if tokio::fs::metadata(&path)
            .await
            .map(|meta| meta.len() > 0)
            .unwrap_or(false)
        {
            return Ok(path);
        }

        let bytes = self.synthesize(text).await?;
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|error| PlayerError::Internal(format!("could not write TTS clip: {error}")))?;
        self.prune().await;
        Ok(path)
    }

    async fn synthesize(&self, text: &str) -> Result<Vec<u8>, PlayerError> {
        let Some(service_url) = self.service_url.clone() else {
            return Err(PlayerError::Internal(
                "TTS service is not configured.".into(),
            ));
        };
        let endpoint = format!("{}/synthesize", service_url.trim_end_matches('/'));
        let response = self
            .http
            .post(&endpoint)
            .json(&serde_json::json!({ "text": text, "voice": self.voice.as_str() }))
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|error| PlayerError::Internal(format!("TTS request failed: {error}")))?;

        if !response.status().is_success() {
            return Err(PlayerError::Internal(format!(
                "TTS service returned {}",
                response.status()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| PlayerError::Internal(format!("TTS body read failed: {error}")))?;
        if bytes.is_empty() {
            return Err(PlayerError::Internal("TTS returned empty audio".into()));
        }
        Ok(bytes.to_vec())
    }

    async fn warmup(&self) {
        let Some(service_url) = self.service_url.clone() else {
            return;
        };
        let endpoint = format!("{}/warmup", service_url.trim_end_matches('/'));
        if let Err(error) = self
            .http
            .post(&endpoint)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            // Synthesis loads lazily on its own, so this is only a latency hint.
            tracing::debug!(%error, "tts warmup skipped or failed");
        }
    }

    /// Keep the cache bounded, oldest first.
    async fn prune(&self) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.cache_dir).await else {
            return;
        };
        let mut files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            files.push((entry.path(), modified));
        }
        if files.len() <= MAX_CACHE_FILES {
            return;
        }
        files.sort_by_key(|(_, modified)| *modified);
        for (path, _) in files.iter().take(files.len() - MAX_CACHE_FILES) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    /// Clear any session on shutdown.
    pub async fn stop(&self) {
        self.inner.lock().await.session = None;
        let _ = self.player.unlock_tts().await;
    }
}

#[allow(dead_code)]
fn unused(_: &Path) {}
