//! Health and readiness endpoints on `:3002`.
//!
//! Mirrors the shape of `apps/bot/src/control/health.ts` so container
//! healthchecks keep working unchanged.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;

#[derive(Clone)]
pub struct Readiness {
    pub gateway: Arc<AtomicBool>,
    pub guild: Arc<AtomicBool>,
    pub valkey: Arc<AtomicBool>,
    pub started_at: Arc<std::time::Instant>,
    pub commands: Arc<AtomicU64>,
}

impl Default for Readiness {
    fn default() -> Self {
        Self {
            gateway: Arc::new(AtomicBool::new(false)),
            guild: Arc::new(AtomicBool::new(false)),
            valkey: Arc::new(AtomicBool::new(false)),
            started_at: Arc::new(std::time::Instant::now()),
            commands: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl Readiness {
    pub fn ready(&self) -> bool {
        self.gateway.load(Ordering::Relaxed)
            && self.guild.load(Ordering::Relaxed)
            && self.valkey.load(Ordering::Relaxed)
    }
}

pub fn router(readiness: Readiness) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/metrics", get(metrics))
        .with_state(readiness)
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn readyz(State(readiness): State<Readiness>) -> Response {
    let gateway = readiness.gateway.load(Ordering::Relaxed);
    let guild = readiness.guild.load(Ordering::Relaxed);
    let valkey = readiness.valkey.load(Ordering::Relaxed);
    let ready = readiness.ready();
    let body = json!({
        "ready": ready,
        "details": { "gateway": gateway, "guild": guild, "valkey": valkey },
    });
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(body)).into_response()
}

async fn metrics(State(readiness): State<Readiness>) -> impl IntoResponse {
    let uptime = readiness.started_at.elapsed().as_secs();
    let commands = readiness.commands.load(Ordering::Relaxed);
    let body = format!(
        "# HELP siela_worker_uptime_seconds Seconds since process start.\n\
         # TYPE siela_worker_uptime_seconds gauge\n\
         siela_worker_uptime_seconds {uptime}\n\
         # HELP siela_worker_commands_total Worker API requests served.\n\
         # TYPE siela_worker_commands_total counter\n\
         siela_worker_commands_total {commands}\n\
         # HELP siela_worker_ready Whether the worker reports ready.\n\
         # TYPE siela_worker_ready gauge\n\
         siela_worker_ready {}\n",
        u8::from(readiness.ready())
    );
    (StatusCode::OK, body)
}
