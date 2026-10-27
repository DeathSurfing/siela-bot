//! Configuration for the voice worker.
//!
//! Mirrors the variables `apps/bot/src/workerEntry.ts` and `voiceNode.ts`
//! read from `@siela/config`, so both workers can share one `.env` shape.

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub discord_token: String,
    pub guild_id: Option<String>,
    pub node_id: String,
    pub node_advertise_url: Option<String>,
    pub valkey_url: Option<String>,
    pub mcp_token: String,
    pub worker_internal_host: String,
    pub worker_internal_port: u16,
    pub health_host: String,
    pub health_port: u16,
    pub ytdlp_path: String,
    pub ffmpeg_path: String,
    pub log_level: String,
    pub tz: String,
}

fn env_opt(name: &str) -> Option<String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    }
}

fn env_or(name: &str, default: &str) -> String {
    env_opt(name).unwrap_or_else(|| default.to_string())
}

fn env_port(name: &str, default: u16) -> Result<u16> {
    match env_opt(name) {
        Some(raw) => raw
            .parse::<u16>()
            .with_context(|| format!("{name} must be a port number, got {raw}")),
        None => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let discord_token =
            env_opt("DISCORD_TOKEN").context("DISCORD_TOKEN is required")?;
        if discord_token.len() < 20 {
            anyhow::bail!("DISCORD_TOKEN must be at least 20 characters");
        }

        let mcp_token = env_opt("MCP_TOKEN").context("MCP_TOKEN is required")?;
        if mcp_token.len() < 16 {
            anyhow::bail!("MCP_TOKEN must be at least 16 characters");
        }

        Ok(Self {
            discord_token,
            guild_id: env_opt("GUILD_ID"),
            node_id: env_or("NODE_ID", "commander"),
            node_advertise_url: env_opt("NODE_ADVERTISE_URL"),
            valkey_url: env_opt("VALKEY_URL"),
            mcp_token,
            worker_internal_host: env_or("WORKER_INTERNAL_HOST", "0.0.0.0"),
            worker_internal_port: env_port("WORKER_INTERNAL_PORT", 3101)?,
            health_host: env_or("HEALTH_HOST", "127.0.0.1"),
            health_port: env_port("HEALTH_PORT", 3002)?,
            ytdlp_path: env_or("YTDLP_PATH", "yt-dlp"),
            ffmpeg_path: env_or("FFMPEG_PATH", "ffmpeg"),
            log_level: env_or("LOG_LEVEL", "info"),
            tz: env_or("TZ", "UTC"),
        })
    }
}
