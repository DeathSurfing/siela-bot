//! Fleet membership and queue persistence in Valkey.
//!
//! Ports `apps/bot/src/features/fleetHeartbeat.ts` and the queue helpers in
//! `MusicService`. The heartbeat contract is shared with the router, so the
//! key layout and TTL must match `packages/shared/src/fleet.ts` exactly.

use std::time::Duration;

use redis::AsyncCommands;
use serde::Serialize;

use crate::model::Track;

pub const FLEET_NODE_KEY_PREFIX: &str = "siela:fleet:node:";
pub const FLEET_HEARTBEAT_TTL_SEC: u64 = 45;
pub const FLEET_HEARTBEAT_INTERVAL_MS: u64 = 15_000;

#[derive(Debug, Clone, Serialize)]
pub struct FleetNodeRecord {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "guildId")]
    pub guild_id: Option<String>,
    pub role: String,
    #[serde(rename = "startedAt")]
    pub started_at: String,
}

pub fn fleet_node_key(node_id: &str) -> String {
    format!("{FLEET_NODE_KEY_PREFIX}{node_id}")
}

pub fn queue_key(node_id: &str, guild_id: &str) -> String {
    format!("siela:music:queue:{node_id}:{guild_id}")
}

/// Thin wrapper over a Redis/Valkey client.
#[derive(Clone)]
pub struct Store {
    client: Option<redis::aio::ConnectionManager>,
    node_id: String,
    base_url: Option<String>,
    started_at: String,
}

impl Store {
    pub async fn connect(url: &str, node_id: impl Into<String>, base_url: Option<String>) -> Self {
        let node_id = node_id.into();
        let started_at = now_iso8601();
        let client = match redis::Client::open(url) {
            Ok(client) => match client.get_connection_manager().await {
                Ok(manager) => Some(manager),
                Err(error) => {
                    tracing::warn!(%error, "valkey unavailable, running without fleet state");
                    None
                }
            },
            Err(error) => {
                tracing::warn!(%error, "invalid valkey url, running without fleet state");
                None
            }
        };
        Self {
            client,
            node_id,
            base_url,
            started_at,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.client.is_some()
    }

    async fn beat(&self, guild_id: Option<&str>) -> anyhow::Result<()> {
        let Some(mut client) = self.client.clone() else {
            return Ok(());
        };
        let Some(base_url) = self.base_url.clone() else {
            return Ok(());
        };
        let record = FleetNodeRecord {
            node_id: self.node_id.clone(),
            base_url,
            guild_id: guild_id.map(str::to_string),
            role: "voice".into(),
            started_at: self.started_at.clone(),
        };
        let payload = serde_json::to_string(&record)?;
        client
            .set_ex::<_, _, ()>(
                fleet_node_key(&self.node_id),
                payload,
                FLEET_HEARTBEAT_TTL_SEC,
            )
            .await?;
        Ok(())
    }

    /// Refresh this node's membership key until the task is cancelled.
    pub async fn heartbeat_loop(
        self,
        guild_id: std::sync::Arc<tokio::sync::RwLock<Option<String>>>,
    ) {
        let mut ticker =
            tokio::time::interval(Duration::from_millis(FLEET_HEARTBEAT_INTERVAL_MS));
        loop {
            ticker.tick().await;
            let guild = guild_id.read().await.clone();
            if let Err(error) = self.beat(guild.as_deref()).await {
                tracing::debug!(%error, "fleet heartbeat failed");
            }
        }
    }

    pub async fn deregister(&self) {
        let Some(mut client) = self.client.clone() else {
            return;
        };
        let _: Result<(), _> = client.del(fleet_node_key(&self.node_id)).await;
    }

    pub async fn load_queue(&self, guild_id: &str) -> Vec<Track> {
        let Some(mut client) = self.client.clone() else {
            return Vec::new();
        };
        let raw: Option<String> = client
            .get(queue_key(&self.node_id, guild_id))
            .await
            .ok()
            .flatten();
        let Some(raw) = raw else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<Track>>(&raw).unwrap_or_default()
    }

    pub async fn save_queue(&self, guild_id: &str, upcoming: &[Track]) {
        let Some(mut client) = self.client.clone() else {
            return;
        };
        let Ok(payload) = serde_json::to_string(upcoming) else {
            return;
        };
        let _: Result<(), _> = client
            .set::<_, _, ()>(queue_key(&self.node_id, guild_id), payload)
            .await;
    }

    pub async fn clear_queue(&self, guild_id: &str) {
        let Some(mut client) = self.client.clone() else {
            return;
        };
        let _: Result<(), _> = client
            .del::<_, ()>(queue_key(&self.node_id, guild_id))
            .await;
    }
}

fn now_iso8601() -> String {
    // Avoid a chrono dependency for one field; the router only stores it.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("@{now}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_the_shared_contract() {
        assert_eq!(fleet_node_key("voice-1"), "siela:fleet:node:voice-1");
        assert_eq!(
            queue_key("voice-1", "123"),
            "siela:music:queue:voice-1:123"
        );
    }
}
