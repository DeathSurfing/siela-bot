use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;

use siela_tts::server::{AppState, SharedState};
use siela_tts::synthesis::Synthesizer;

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

    tracing::info!(model_path, voices_path, "loading model");
    let mut synth =
        Synthesizer::load(&model_path, &voices_path, default_voice.clone(), default_speed)
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "failed to load synthesizer");
                std::process::exit(1);
            });
    // Validate the default voice up front (mirrors the Python ValueError).
    let config = siela_tts::pipeline::ModelConfigJson::load(&config_path, synth.voice_names())
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load model config");
            std::process::exit(1);
        });
    if let Err(e) = siela_tts::pipeline::resolve_voice(&config, &default_voice, default_speed) {
        tracing::error!(error = %e, "invalid default voice");
        std::process::exit(1);
    }
    let _ = &mut synth;

    let state: SharedState = Arc::new(TokioMutex::new(AppState {
        synth: Arc::new(Mutex::new(synth)),
        config,
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
