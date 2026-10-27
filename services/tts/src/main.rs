use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use siela_tts::server::{AppState, SharedState};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let model_path = env_or("MODEL_PATH", "/models/kitten_tts_nano_v0_8.onnx");
    let voices_path = env_or("VOICES_PATH", "/models/voices.npz");
    let config_path = env_or("CONFIG_PATH", "/models/config.json");
    let default_voice = env_or("TTS_VOICE", "Bruno");
    let default_speed: f32 = env_or("TTS_SPEED", "1.0").parse().unwrap_or(1.0);
    let host = env_or("HOST", "0.0.0.0");
    let port: u16 = env_or("PORT", "8000").parse().unwrap_or(8000);

    // The model loads on first use. The bot warms it on `/tts on` and drops
    // it on `/tts off`, so an idle service holds no weights.
    tracing::info!(model_path, voices_path, "lazy model loading enabled");
    let state: SharedState = Arc::new(TokioMutex::new(AppState {
        synth: None,
        config: None,
        model_path,
        voices_path,
        config_path,
        default_voice,
        default_speed,
    }));

    let app = siela_tts::server::router(state);
    let addr = format!("{host}:{port}");
    tracing::info!(addr, "listening");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        tracing::error!(error = %e, "bind failed");
        std::process::exit(1);
    });
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, "serve failed");
            std::process::exit(1);
        });
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = term.recv() => {},
            _ = int.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
    tracing::info!("shutting down");
}
