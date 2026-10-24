//! HTTP surface. Mirrors `deploy/podman/tts/server.py` exactly:
//! `GET /healthz`, `POST /synthesize`, `POST /synthesize-stream`.

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
use crate::synthesis::SharedSynthesizer;
use crate::wav;

#[derive(Clone)]
pub struct AppState {
    pub synth: SharedSynthesizer,
    pub config: ModelConfigJson,
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
    state: &AppState,
    req: &SynthesisRequest,
) -> Result<(String, f32), (StatusCode, String)> {
    let voice = req.voice.as_deref().unwrap_or(&state.default_voice);
    // Empty voice behaves like the Python default (`request.voice or VOICE`).
    let voice = if voice.is_empty() {
        state.default_voice.as_str()
    } else {
        voice
    };
    resolve_voice(&state.config, voice, state.default_speed)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))
}

async fn healthz() -> impl IntoResponse {
    axum::Json(serde_json::json!({ "status": "ok" }))
}

async fn synthesize(
    State(state): State<SharedState>,
    axum::Json(req): axum::Json<SynthesisRequest>,
) -> Response {
    let (voice, speed) = {
        let guard = state.lock().await;
        match resolve_request(&guard, &req) {
            Ok(v) => v,
            Err((code, msg)) => return (code, msg).into_response(),
        }
    };
    // Serialize synthesis on the blocking pool: the pipeline holds a
    // process-wide lock and must not block async workers.
    let synth = {
        let guard = state.lock().await;
        guard.synth.clone()
    };
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
    let (voice, speed, synth) = {
        let guard = state.lock().await;
        let (voice, speed) = match resolve_request(&guard, &req) {
            Ok(v) => v,
            Err((code, msg)) => return (code, msg).into_response(),
        };
        (voice, speed, guard.synth.clone())
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
        .route("/synthesize", post(synthesize))
        .route("/synthesize-stream", post(synthesize_stream))
        .with_state(state)
}
