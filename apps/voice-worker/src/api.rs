//! Internal worker API on `:3101`.
//!
//! Route names, methods, and payloads must stay identical to
//! `apps/bot/src/control/worker.ts` because the router speaks to both the
//! TypeScript and Rust workers with the same client.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::player::{PlayerHandle, PlayerError};
use crate::tts::TtsHandle;

#[derive(Clone)]
pub struct ApiState {
    pub token: Arc<String>,
    pub player: PlayerHandle,
    pub tts: TtsHandle,
}

/// Constant-time bearer comparison, matching the TypeScript `timingSafeEqual` use.
fn authorized(headers: &HeaderMap, expected: &str) -> bool {
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some(provided) = value.strip_prefix("Bearer ") else {
        return false;
    };
    if provided.len() != expected.len() {
        return false;
    }
    provided
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

struct ApiError(PlayerError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            PlayerError::NotReady | PlayerError::Unavailable => StatusCode::BAD_REQUEST,
            _ => StatusCode::BAD_REQUEST,
        };
        let body = json!({
            "error": {
                "code": self.0.code(),
                "message": self.0.to_string(),
            }
        });
        (status, Json(body)).into_response()
    }
}

impl From<PlayerError> for ApiError {
    fn from(error: PlayerError) -> Self {
        Self(error)
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self(PlayerError::Internal(error.to_string()))
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinBody {
    voice_channel_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayBody {
    query: String,
    voice_channel_id: Option<String>,
    #[serde(default)]
    next: bool,
}

#[derive(Deserialize)]
struct VolumeBody {
    volume: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeekBody {
    position_ms: i64,
}

#[derive(Deserialize)]
struct LoopBody {
    mode: String,
}

#[derive(Deserialize)]
struct SkipBody {
    #[serde(default = "one")]
    count: i64,
}

fn one() -> i64 {
    1
}

#[derive(Deserialize)]
struct IndexBody {
    index: i64,
}

#[derive(Deserialize)]
struct MoveBody {
    from: i64,
    to: i64,
}

#[derive(Deserialize)]
struct AutoplayBody {
    enabled: bool,
}

#[derive(Deserialize)]
struct FilterBody {
    preset: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsEnableBody {
    channel_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsSpeakBody {
    utterance: String,
    speaker_id: Option<String>,
}

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/internal/music/state", get(music_state))
        .route("/internal/music/join", post(music_join))
        .route("/internal/music/play", post(music_play))
        .route("/internal/music/pause", post(music_pause))
        .route("/internal/music/resume", post(music_resume))
        .route("/internal/music/stop", post(music_stop))
        .route("/internal/music/disconnect", post(music_disconnect))
        .route("/internal/music/clear", post(music_clear))
        .route("/internal/music/shuffle", post(music_shuffle))
        .route("/internal/music/skip", post(music_skip))
        .route("/internal/music/volume", post(music_volume))
        .route("/internal/music/seek", post(music_seek))
        .route("/internal/music/loop", post(music_loop))
        .route("/internal/music/remove", post(music_remove))
        .route("/internal/music/move", post(music_move))
        .route("/internal/music/jump", post(music_jump))
        .route("/internal/music/autoplay", post(music_autoplay))
        .route("/internal/music/filters", post(music_filters))
        .route("/internal/tts/state", get(tts_state))
        .route("/internal/tts/enable", post(tts_enable))
        .route("/internal/tts/disable", post(tts_disable))
        .route("/internal/tts/speak", post(tts_speak))
        .with_state(state)
}

macro_rules! guard {
    ($state:expr, $headers:expr) => {
        if !authorized(&$headers, &$state.token) {
            return Err(ApiError(PlayerError::Unauthorized));
        }
    };
}

async fn music_state(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    Ok(Json(serde_json::to_value(state.player.state().await)?))
}

async fn music_join(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<JoinBody>,
) -> ApiResult {
    guard!(state, headers);
    let channel = state.player.join(body.voice_channel_id).await?;
    Ok(Json(json!({ "channelId": channel })))
}

async fn music_play(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<PlayBody>,
) -> ApiResult {
    guard!(state, headers);
    let outcome = state
        .player
        .play(body.query, body.voice_channel_id, body.next)
        .await?;
    Ok(Json(serde_json::to_value(outcome)?))
}

async fn music_pause(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.pause().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_resume(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.resume().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_stop(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.stop().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_disconnect(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.disconnect().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_clear(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.clear().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_shuffle(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.player.shuffle().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_skip(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<SkipBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.skip(body.count).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_volume(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<VolumeBody>,
) -> ApiResult {
    guard!(state, headers);
    let volume = state.player.volume(body.volume).await?;
    Ok(Json(json!({ "volume": volume })))
}

async fn music_seek(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<SeekBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.seek(body.position_ms).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_loop(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<LoopBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.set_loop_mode(&body.mode).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_remove(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<IndexBody>,
) -> ApiResult {
    guard!(state, headers);
    let removed = state.player.remove(body.index).await?;
    Ok(Json(json!({ "removed": removed })))
}

async fn music_move(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<MoveBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.move_track(body.from, body.to).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_jump(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<IndexBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.jump(body.index).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_autoplay(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<AutoplayBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.set_autoplay(body.enabled).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn music_filters(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<FilterBody>,
) -> ApiResult {
    guard!(state, headers);
    state.player.set_filter(&body.preset).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn tts_state(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    Ok(Json(serde_json::to_value(state.tts.state().await)?))
}

async fn tts_enable(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<TtsEnableBody>,
) -> ApiResult {
    guard!(state, headers);
    state.tts.enable(body.channel_id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn tts_disable(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    guard!(state, headers);
    state.tts.disable().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn tts_speak(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<TtsSpeakBody>,
) -> ApiResult {
    guard!(state, headers);
    state.tts.speak(body.utterance, body.speaker_id).await?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(value: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(value).unwrap(),
        );
        map
    }

    #[test]
    fn accepts_matching_token() {
        assert!(authorized(&headers("Bearer abcdefghijklmnop"), "abcdefghijklmnop"));
    }

    #[test]
    fn rejects_wrong_or_missing_token() {
        assert!(!authorized(&headers("Bearer wrong"), "abcdefghijklmnop"));
        assert!(!authorized(&headerless(), "abcdefghijklmnop"));
        assert!(!authorized(&headers("abcdefghijklmnop"), "abcdefghijklmnop"));
    }

    fn headerless() -> HeaderMap {
        HeaderMap::new()
    }
}
