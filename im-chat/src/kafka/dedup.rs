const COMPLETED_TTL_SECONDS: u64 = 604_800;

pub(super) struct CompletedEvents {
    client: redis::Client,
    group_id: String,
}

impl CompletedEvents {
    pub(super) fn new(client: redis::Client, group_id: String) -> Self {
        Self { client, group_id }
    }

    pub(super) async fn contains(&self, event_id: &str) -> Result<bool, redis::RedisError> {
        let mut connection = self.client.get_multiplexed_async_connection().await?;
        redis::cmd("EXISTS")
            .arg(self.key(event_id))
            .query_async(&mut connection)
            .await
    }

    pub(super) async fn complete(&self, event_id: &str) -> Result<(), redis::RedisError> {
        let mut connection = self.client.get_multiplexed_async_connection().await?;
        // A single command makes the completion marker and its expiration atomic.
        self.complete_command(event_id)
            .query_async(&mut connection)
            .await
    }

    fn key(&self, event_id: &str) -> String {
        format!("chat:delivery:done:{}:{event_id}", self.group_id)
    }

    fn complete_command(&self, event_id: &str) -> redis::Cmd {
        let mut command = redis::cmd("SET");
        command
            .arg(self.key(event_id))
            .arg("1")
            .arg("EX")
            .arg(COMPLETED_TTL_SECONDS);
        command
    }
}

#[cfg(test)]
#[path = "dedup_tests.rs"]
mod tests;
