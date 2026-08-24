use crate::config::RedisConfig;
use time::{OffsetDateTime, UtcOffset};

#[derive(Clone)]
pub(crate) struct PresenceManager {
    client: redis::Client,
}

impl PresenceManager {
    pub(crate) fn new(redis_config: &RedisConfig) -> Result<Self, redis::RedisError> {
        let url = format!(
            "redis://{}:{}@{}:{}/{}",
            redis_config.username,
            redis_config.password,
            redis_config.ip,
            redis_config.port,
            redis_config.db
        );
        let client = redis::Client::open(url)?;
        Ok(PresenceManager { client })
    }

    pub(crate) async fn register_node(
        &self,
        node_id: &str,
        public_ws_url: &str,
        rpc_addr: &str,
    ) -> Result<(), redis::RedisError> {
        let key = format!("chat_nodes:{}", node_id);
        let now = OffsetDateTime::now_utc()
            .to_offset(UtcOffset::from_hms(8, 0, 0).unwrap())
            .to_string();
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let _: () = redis::pipe()
            .hset_multiple(
                &key,
                &[
                    ("node_id", node_id),
                    ("public_ws_url", public_ws_url),
                    ("rpc_addr", rpc_addr),
                    ("state", "ready"),
                    ("started_at", now.as_str()),
                    ("last_heartbeat_at", now.as_str()),
                ],
            )
            .ignore()
            .expire(&key, 30)
            .ignore()
            .query_async(&mut conn)
            .await?;

        Ok(())
    }

    pub(crate) async fn refresh_node(&self, node_id: &str) -> Result<bool, redis::RedisError> {
        let key = format!("chat_nodes:{}", node_id);
        let now = OffsetDateTime::now_utc()
            .to_offset(UtcOffset::from_hms(8, 0, 0).unwrap())
            .to_string();
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let script = redis::Script::new(
            r#"
            if redis.call("EXISTS", KEYS[1]) == 0 then
                return 0
            end
            redis.call("HSET", KEYS[1], "last_heartbeat_at", ARGV[1])
            redis.call("EXPIRE", KEYS[1], ARGV[2])
            return 1
        "#,
        );
        let refreshed: i64 = script
            .key(&key)
            .arg(now.as_str())
            .arg(30)
            .invoke_async(&mut conn)
            .await?;
        Ok(refreshed == 1)
    }

    pub(crate) async fn update_presence(
        &self,
        user_id: u64,
        connection_id: &str,
        node_id: &str,
        access_token_expires_at: &str,
    ) -> Result<(), redis::RedisError> {
        let key = format!("presence:user:{}", user_id);
        let now = OffsetDateTime::now_utc()
            .to_offset(UtcOffset::from_hms(8, 0, 0).unwrap())
            .to_string();
        let user_id_str = user_id.to_string();
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let _: () = redis::pipe()
            .hset_multiple(
                &key,
                &[
                    ("user_id", user_id_str.as_str()),
                    ("node_id", node_id),
                    ("connection_id", connection_id),
                    ("access_token_expires_at", access_token_expires_at),
                    ("connected_at", now.as_str()),
                    ("last_heartbeat_at", now.as_str()),
                ],
            )
            .ignore()
            .expire(&key, 30)
            .ignore()
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    pub(crate) async fn leave_presence(
        &self,
        user_id: u64,
        connection_id: &str,
    ) -> Result<(), redis::RedisError> {
        let key = format!("presence:user:{}", user_id);
        let mut conn = self.client.get_multiplexed_async_connection().await?;

        let script = redis::Script::new(
            r#"
            local current = redis.call("HGET", KEYS[1], "connection_id")
            if current == ARGV[1] then
                redis.call("DEL", KEYS[1])
                return 1
            else
                return 0
            end
        "#,
        );

        let deleted: i64 = script
            .key(&key)
            .arg(connection_id)
            .invoke_async(&mut conn)
            .await?;

        if deleted == 1 {
            tracing::debug!(user_id, connection_id, "presence deleted");
        } else {
            tracing::debug!(
                user_id,
                connection_id,
                "skip deleting presence: connection_id mismatch or key not found"
            );
        }

        Ok(())
    }
}
