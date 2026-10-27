//! Sticky TTS session.
//!
//! Ports the session model from `apps/bot/src/features/tts.ts`. Synthesis
//! stays on the existing KittenTTS service; this module owns the session
//! state, the idle timer, and playing the synthesized clip.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use crate::model::TtsState;
use crate::player::{PlayerError, PlayerHandle};

/// Session ends after this long with nothing spoken, matching `TTS_IDLE_MS`.
pub const TTS_IDLE_MS: u64 = 30_000;
const IDLE_POLL_MS: u64 = 5_000;

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
    player: PlayerHandle,
    http: reqwest::Client,
}

impl TtsHandle {
    pub fn new(node_id: impl Into<String>, service_url: Option<String>, player: PlayerHandle) -> Self {
        let handle = Self {
            inner: Arc::new(Mutex::new(Inner {
                session: None,
                last_activity: Instant::now(),
            })),
            node_id: Arc::new(node_id.into()),
            service_url: service_url.map(Arc::new),
            player,
            http: reqwest::Client::new(),
        };

        // Idle sessions drop themselves so a worker never sits in voice forever.
        let watchdog = handle.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(IDLE_POLL_MS)).await;
                let should_disable = {
                    let inner = watchdog.inner.lock().await;
                    inner.session.as_ref().map(|session| session.enabled).unwrap_or(false)
                        && inner.last_activity.elapsed() >= Duration::from_millis(TTS_IDLE_MS)
                };
                if should_disable {
                    let mut inner = watchdog.inner.lock().await;
                    inner.session = None;
                    tracing::info!("TTS session idle, disabled");
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

    pub async fn enabled(&self) -> bool {
        self.inner
            .lock()
            .await
            .session
            .as_ref()
            .map(|session| session.enabled)
            .unwrap_or(false)
    }

    pub async fn enable(&self, channel_id: String) -> Result<(), PlayerError> {
        self.player.join(Some(channel_id.clone())).await?;
        let mut inner = self.inner.lock().await;
        inner.session = Some(Session {
            channel_id,
            node_id: (*self.node_id).clone(),
            enabled: true,
        });
        inner.last_activity = Instant::now();
        Ok(())
    }

    pub async fn disable(&self) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().await;
        inner.session = None;
        Ok(())
    }

    /// Synthesize a clip and play it on the current voice connection.
    pub async fn speak(
        &self,
        utterance: String,
        _speaker_id: Option<String>,
    ) -> Result<(), PlayerError> {
        if !self.enabled().await {
            return Ok(());
        }
        self.touch().await;

        let Some(service_url) = self.service_url.clone() else {
            return Err(PlayerError::Internal(
                "TTS service is not configured.".into(),
            ));
        };

        let bytes = self.synthesize(&service_url, &utterance).await?;
        let path = std::env::temp_dir().join(format!("siela-tts-{}.mp3", uuid_like()));
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|error| PlayerError::Internal(format!("could not write TTS clip: {error}")))?;

        let result = self
            .player
            .play_file(path.to_string_lossy().to_string())
            .await;

        let _ = tokio::fs::remove_file(&path).await;
        result
    }

    async fn touch(&self) {
        self.inner.lock().await.last_activity = Instant::now();
    }

    async fn synthesize(&self, service_url: &str, text: &str) -> Result<Vec<u8>, PlayerError> {
        let endpoint = format!("{}/synthesize", service_url.trim_end_matches('/'));
        let response = self
            .http
            .post(&endpoint)
            .json(&serde_json::json!({ "text": text }))
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|error| PlayerError::Internal(format!("TTS request failed: {error}")))?;

        if !response.status().is_success() {
            return Err(PlayerError::Internal(format!(
                "TTS service returned {}",
                response.status()
            )));
        }
        response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| PlayerError::Internal(format!("TTS body read failed: {error}")))
    }

    /// Clear any session on shutdown.
    pub async fn stop(&self) {
        self.inner.lock().await.session = None;
    }
}

fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}
