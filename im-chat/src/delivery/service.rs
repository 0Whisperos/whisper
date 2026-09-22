use crate::connection::{ConnectionRegistry, SendToConnectionResult};
use crate::frame::PushFrame;
use crate::message::{AcceptedMessage, MessageCreatedEvent};
use crate::presence::{PresenceManager, RouteState};
use axum::extract::ws::Message;
use serde::Serialize;
use sqlx::MySqlPool;
use std::{future::Future, sync::Arc};

use super::store;

#[derive(Debug, thiserror::Error)]
pub(crate) enum DeliveryError {
    #[error("failed to query active conversation members: {0}")]
    Members(#[from] sqlx::Error),
    #[error("failed to read online routing: {0}")]
    Presence(#[from] redis::RedisError),
    #[error("failed to serialize message push: {0}")]
    Serialize(#[from] serde_json::Error),
}

pub(crate) struct DeliveryService {
    pool: MySqlPool,
    presence: Arc<PresenceManager>,
    connections: ConnectionRegistry,
    node_id: String,
}

#[derive(Serialize)]
struct MessageCreatedPayload<'a> {
    event_id: &'a str,
    message: &'a AcceptedMessage,
}

/// Keep reads behind one boundary so no member is enqueued before all reads succeed.
trait DeliveryLookup: Sync {
    fn members(
        &self,
        conversation_id: u64,
    ) -> impl Future<Output = Result<Vec<u64>, DeliveryError>> + Send;
    fn route(&self, user_id: u64)
    -> impl Future<Output = Result<RouteState, DeliveryError>> + Send;
}

impl DeliveryLookup for DeliveryService {
    async fn members(&self, conversation_id: u64) -> Result<Vec<u64>, DeliveryError> {
        Ok(store::active_members(&self.pool, conversation_id).await?)
    }

    async fn route(&self, user_id: u64) -> Result<RouteState, DeliveryError> {
        Ok(self.presence.read_route(user_id).await?)
    }
}

impl DeliveryService {
    pub(crate) fn new(
        pool: MySqlPool,
        presence: Arc<PresenceManager>,
        connections: ConnectionRegistry,
        node_id: String,
    ) -> Self {
        Self {
            pool,
            presence,
            connections,
            node_id,
        }
    }

    pub(crate) async fn deliver(&self, event: &MessageCreatedEvent) -> Result<(), DeliveryError> {
        self.deliver_with_lookup(event, self).await
    }

    async fn deliver_with_lookup(
        &self,
        event: &MessageCreatedEvent,
        lookup: &impl DeliveryLookup,
    ) -> Result<(), DeliveryError> {
        let frame = PushFrame::new(
            "message_created",
            MessageCreatedPayload {
                event_id: &event.event_id,
                message: &event.message,
            },
        );
        let text = serde_json::to_string(&frame)?;
        let members = lookup.members(event.message.conversation_id).await?;
        let mut routes = Vec::with_capacity(members.len());
        for user_id in members {
            routes.push((user_id, lookup.route(user_id).await?));
        }

        // All fallible IO and serialization has completed. Queue failures below
        // finish this delivery decision rather than causing partial fanout retries.
        for (user_id, route) in routes {
            match route {
                RouteState::Offline => tracing::debug!(
                    event_id = %event.event_id, user_id, "skip offline recipient"
                ),
                RouteState::Invalid => tracing::warn!(
                    event_id = %event.event_id, user_id, "skip malformed presence route"
                ),
                RouteState::Online(route) if route.node_id != self.node_id => {
                    // TODO: 后续通过 RPC 转发到目标 im-chat 节点；当前仅记录日志，不执行跨节点投递。
                    tracing::info!(
                        event_id = %event.event_id,
                        message_id = %event.message.message_id,
                        conversation_id = event.message.conversation_id,
                        user_id,
                        current_node = %self.node_id,
                        target_node = %route.node_id,
                        connection_id = %route.connection_id,
                        "remote message delivery deferred until RPC is implemented"
                    );
                }
                RouteState::Online(route) => {
                    let result = self.connections.send_to_connection(
                        user_id,
                        &route.connection_id,
                        Message::Text(text.clone().into()),
                    );
                    if result != SendToConnectionResult::Sent {
                        tracing::warn!(
                            event_id = %event.event_id,
                            message_id = %event.message.message_id,
                            conversation_id = event.message.conversation_id,
                            user_id,
                            connection_id = %route.connection_id,
                            ?result,
                            "local message was not enqueued"
                        );
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
