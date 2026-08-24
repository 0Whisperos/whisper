use std::sync::Arc;
use std::time::Duration;
use crate::presence::PresenceManager;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);

pub(crate) async fn spawn(presence: Arc<PresenceManager>, node_id: String) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
        loop {
            ticker.tick().await;
            run_once(presence.clone(), &node_id).await;
        }
    })
}

pub(crate) async fn run_once(presence: Arc<PresenceManager>, node_id: &str) {
    match presence.refresh_node(&node_id).await {
        Ok(true) => {
            tracing::debug!(node_id, "node heartbeat refreshed");
        }
        Ok(false) => {
            tracing::warn!(node_id, "node presence expired, re-registering is required");
            // TODO: 触发重新 register_node，或上报告警
        }
        Err(err) => {
            tracing::warn!(%err, node_id, "failed to refresh node heartbeat");
        }
    }
}
