//! HTTP surface. `GET /healthz`, `POST /warmup`, `POST /unload`,
//! `POST /synthesize`, `POST /synthesize-stream`.
//!
//! The model loads on first use and `POST /unload` drops it so the service
//! can sit idle without holding the ONNX weights in memory. The bot calls
//! warmup on `/tts on` and unload on `/tts off`.

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use tokio::sync::Mutex as TokioMutex;
use std::sync::Arc;

use crate::pipeline::resolve_voice;
use crate::pipeline::ModelConfigJson;
use crate::synthesis::{SharedSynthesizer, Synthesizer};
use crate::wav;

#[derive(Clone)]
pub struct AppState {
    /// `None` until the first synthesis or until `/warmup`.
    pub synth: Option<SharedSynthesizer>,
    /// Built alongside the synthesizer because voice validation needs it.
    pub config: Option<ModelConfigJson>,
    pub model_path: String,
    pub voices_path: String,
    pub config_path: String,
    pub default_voice: String,
    pub default_speed: f32,
}

pub type SharedState = Arc<TokioMutex<AppState>>;

#[derive(Debug, Deserialize)]
struct SynthesisRequest {
    text: String,
    voice: Option<String>,
}

fn resolve_request(
    config: &ModelConfigJson,
    default_voice: &str,
    default_speed: f32,
    req: &SynthesisRequest,
) -> Result<(String, f32), (StatusCode, String)> {
    let voice = req.voice.as_deref().unwrap_or(default_voice);
    // Empty voice behaves like the Python default (`request.voice or VOICE`).
    let voice = if voice.is_empty() { default_voice } else { voice };
    resolve_voice(config, voice, default_speed)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))
}

type Loaded = (SharedSynthesizer, ModelConfigJson, String, f32);

async fn ensure_loaded(state: &SharedState) -> Result<Loaded, (StatusCode, String)> {
    let mut guard = state.lock().await;
    if let (Some(synth), Some(config)) = (guard.synth.clone(), guard.config.clone()) {
        return Ok((synth, config, guard.default_voice.clone(), guard.default_speed));
    }

    let model_path = guard.model_path.clone();
    let voices_path = guard.voices_path.clone();
    let config_path = guard.config_path.clone();
    let voice = guard.default_voice.clone();
    let speed = guard.default_speed;

    tracing::info!(model_path, "loading model on demand");
    let loaded = tokio::task::spawn_blocking(move || {
        let synth = Synthesizer::load(&model_path, &voices_path, voice.clone(), speed)?;
        let config = ModelConfigJson::load(&config_path, synth.voice_names())?;
        resolve_voice(&config, &voice, speed)?;
        Ok::<_, String>((synth, config))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("join: {e}")))?;

    let (synth, config) = match loaded {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "lazy model load failed");
            return Err((StatusCode::SERVICE_UNAVAILABLE, error));
        }
    };

    let shared = Arc::new(std::sync::Mutex::new(synth));
    guard.synth = Some(shared.clone());
    guard.config = Some(config.clone());
    tracing::info!("model ready");
    Ok((shared, config, guard.default_voice.clone(), guard.default_speed))
}

async fn healthz(State(state): State<SharedState>) -> impl IntoResponse {
    let loaded = state.lock().await.synth.is_some();
    axum::Json(serde_json::json!({ "status": "ok", "loaded": loaded }))
}

async fn warmup(State(state): State<SharedState>) -> Response {
    match ensure_loaded(&state).await {
        Ok(_) => axum::Json(serde_json::json!({ "status": "ok", "loaded": true })).into_response(),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

async fn unload(State(state): State<SharedState>) -> impl IntoResponse {
    let was_loaded = {
        let mut guard = state.lock().await;
        let was_loaded = guard.synth.is_some();
        guard.synth = None;
        guard.config = None;
        was_loaded
    };
    if was_loaded {
        // glibc keeps freed arenas; return them so the container actually
        // gives the memory back instead of sitting at its peak.
        #[cfg(target_os = "linux")]
        unsafe {
            libc::malloc_trim(0);
        }
        tracing::info!("model unloaded");
    }
    axum::Json(serde_json::json!({ "status": "ok", "loaded": false }))
}

async fn synthesize(
    State(state): State<SharedState>,
    axum::Json(req): axum::Json<SynthesisRequest>,
) -> Response {
    let (synth, config, default_voice, default_speed) = match ensure_loaded(&state).await {
        Ok(value) => value,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let (voice, speed) = match resolve_request(&config, &default_voice, default_speed, &req) {
        Ok(v) => v,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    // Serialize synthesis on the blocking pool: the pipeline holds a
    // process-wide lock and must not block async workers.
    let audio = tokio::task::spawn_blocking(move || {
        let mut synth = synth.lock().map_err(|_| "synthesizer lock poisoned")?;
        synth.synthesize(&req.text, &voice, speed)
    })
    .await
    .map_err(|e| format!("join: {e}"));
    let audio = match audio {
        Ok(Ok(a)) => a,
        Ok(Err(e)) => return (StatusCode::UNPROCESSABLE_ENTITY, e).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    let wav = wav::encode_wav_i16(&audio);
    (
        [(header::CONTENT_TYPE, "audio/wav")],
        wav,
    )
        .into_response()
}

async fn synthesize_stream(
    State(state): State<SharedState>,
    axum::Json(req): axum::Json<SynthesisRequest>,
) -> Response {
    let (synth, config, default_voice, default_speed) = match ensure_loaded(&state).await {
        Ok(value) => value,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let (voice, speed) = match resolve_request(&config, &default_voice, default_speed, &req) {
        Ok(v) => v,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let stream = async_stream_body(synth, req.text, voice, speed);
    (
        [(header::CONTENT_TYPE, "audio/wav")],
        Body::from_stream(stream),
    )
        .into_response()
}

fn async_stream_body(
    synth: SharedSynthesizer,
    text: String,
    voice: String,
    speed: f32,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, String>> {
    async_stream::try_stream! {
        yield bytes::Bytes::from(wav::wav_stream_header());
        let chunks = crate::pipeline::chunk_text(&text);
        for chunk in chunks {
            let synth = synth.clone();
            let voice = voice.clone();
            let chunk = chunk.clone();
            let pcm: Vec<u8> = tokio::task::spawn_blocking(move || {
                let mut synth = synth.lock().map_err(|_| "synthesizer lock poisoned".to_string())?;
                // One chunk at a time, mirroring the Python generator.
                let audio = synth.synthesize(&chunk, &voice, speed)?;
                Ok::<Vec<u8>, String>(wav::to_i16_samples(&audio))
            })
            .await
            .map_err(|e| format!("join: {e}"))??;
            yield bytes::Bytes::from(pcm);
        }
    }
}

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/warmup", post(warmup))
        .route("/unload", post(unload))
        .route("/synthesize", post(synthesize))
        .route("/synthesize-stream", post(synthesize_stream))
        .with_state(state)
}
