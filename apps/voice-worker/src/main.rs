//! Voice worker entrypoint.
//!
//! Drop-in replacement for `bun dist/worker.js`: same environment, same
//! internal API on `:3101`, same health on `:3002`, same Valkey heartbeat.

mod api;
mod audio;
mod cache;
mod config;
mod fleet;
mod health;
mod model;
mod player;
mod resolve;
mod tts;

use std::sync::Arc;

use serenity::{
    async_trait,
    client::{Client, Context, EventHandler},
    model::{
        gateway::{GatewayIntents, Ready},
        guild::Guild,
        id::GuildId,
    },
};
use songbird::{SerenityInit, Songbird};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::{
    audio::{AudioConfig, DecodeMode},
    cache::TrackCache,
    config::Config,
    fleet::Store,
    health::Readiness,
    player::Player,
    resolve::Resolver,
    tts::TtsHandle,
};

struct Handler {
    guild_id: Arc<RwLock<Option<String>>>,
    readiness: Readiness,
}

#[async_trait]
impl EventHandler for Handler {
    async fn ready(&self, ctx: Context, ready: Ready) {
        info!(user = %ready.user.name, node = %ready.user.id, "voice worker logged in");
        self.readiness.gateway.store(true, std::sync::atomic::Ordering::Relaxed);

        let bound = bind_guild(&ctx, &self.guild_id, &self.readiness).await;
        if !bound {
            warn!("no guild bound yet; waiting for the first guild join");
        }
    }

    async fn guild_create(&self, ctx: Context, guild: Guild, _is_new: Option<bool>) {
        let configured = self.guild_id.read().await.clone();
        match configured {
            Some(configured) if guild.id.to_string() != configured => {
                info!(guild = %guild.id, "leaving unbound guild");
                let _ = guild.leave(&ctx.http).await;
            }
            Some(_) => {
                // This is the configured guild. Mark ready even though the id
                // was already known from the environment.
                self.readiness
                    .guild
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                info!(guild = %guild.id, "voice worker bound");
            }
            None => {
                *self.guild_id.write().await = Some(guild.id.to_string());
                self.readiness
                    .guild
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                info!(guild = %guild.id, "voice worker bound");
            }
        }
    }
}

async fn bind_guild(ctx: &Context, guild_id: &Arc<RwLock<Option<String>>>, readiness: &Readiness) -> bool {
    let guilds: Vec<GuildId> = ctx.cache.guilds();
    let chosen = if let Some(configured) = guild_id.read().await.clone() {
        configured
            .parse::<GuildId>()
            .ok()
            .filter(|id| guilds.contains(id))
    } else if guilds.len() == 1 {
        guilds.first().copied()
    } else {
        None
    };

    let Some(chosen) = chosen else {
        return false;
    };
    *guild_id.write().await = Some(chosen.to_string());
    readiness.guild.store(true, std::sync::atomic::Ordering::Relaxed);
    info!(guild = %chosen, "voice worker bound");
    true
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;

    let filter = tracing_subscriber::EnvFilter::try_new(&config.log_level)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .init();

    std::env::set_var("TZ", &config.tz);
    info!(node = %config.node_id, decoder = ?DecodeMode::from_env(), "voice worker starting");

    let guild_id = Arc::new(RwLock::new(config.guild_id.clone()));
    let readiness = Readiness::default();

    let intents = GatewayIntents::GUILDS | GatewayIntents::GUILD_VOICE_STATES;
    // Build the voice manager first so the player owns a handle before the
    // gateway starts. songbird::get only works from a Context, which does not
    // exist yet at this point.
    let manager = Songbird::serenity();
    let mut client = Client::builder(&config.discord_token, intents)
        .event_handler(Handler {
            guild_id: guild_id.clone(),
            readiness: readiness.clone(),
        })
        .register_songbird_with(manager.clone())
        .await?;

    let store = match &config.valkey_url {
        Some(url) => Store::connect(url, config.node_id.clone(), config.node_advertise_url.clone()).await,
        None => Store::connect("redis://127.0.0.1:6379", config.node_id.clone(), None).await,
    };
    readiness
        .valkey
        .store(store.is_connected(), std::sync::atomic::Ordering::Relaxed);

    let resolver = Resolver::new(config.ytdlp_path.clone());
    let audio = AudioConfig {
        mode: DecodeMode::from_env(),
        ffmpeg_path: config.ffmpeg_path.clone(),
        cache: TrackCache::new(config.ytdlp_path.clone()),
        resolver: Resolver::new(config.ytdlp_path.clone()),
    };

    let player = Player::spawn(
        guild_id.clone(),
        manager,
        resolver,
        store.clone(),
        audio,
    );
    let tts = TtsHandle::new(
        config.node_id.clone(),
        std::env::var("TTS_SERVICE_URL").ok(),
        player.clone(),
    );

    let api_state = api::ApiState {
        token: Arc::new(config.mcp_token.clone()),
        player: player.clone(),
        tts: tts.clone(),
    };
    let api_router = api::router(api_state);
    let health_router = health::router(readiness.clone());

    let api_addr = format!("{}:{}", config.worker_internal_host, config.worker_internal_port);
    let health_addr = format!("{}:{}", config.health_host, config.health_port);

    let api_listener = tokio::net::TcpListener::bind(&api_addr).await?;
    let health_listener = tokio::net::TcpListener::bind(&health_addr).await?;
    info!(addr = %api_addr, "worker API listening");
    info!(addr = %health_addr, "health/metrics listening");

    tokio::spawn(async move {
        if let Err(error) = axum::serve(api_listener, api_router).await {
            error!(%error, "worker API stopped");
        }
    });
    tokio::spawn(async move {
        if let Err(error) = axum::serve(health_listener, health_router).await {
            error!(%error, "health server stopped");
        }
    });

    if store.is_connected() {
        let heartbeat_store = store.clone();
        tokio::spawn(async move {
            heartbeat_store.heartbeat_loop(guild_id).await;
        });
    }

    let shutdown_store = store.clone();
    let shutdown_tts = tts.clone();
    tokio::spawn(async move {
        // podman stop sends SIGTERM, so handle both signals.
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
        info!("shutdown signal received");
        shutdown_tts.stop().await;
        shutdown_store.deregister().await;
        std::process::exit(0);
    });

    client.start().await?;
    Ok(())
}
