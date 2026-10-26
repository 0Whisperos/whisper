use crate::connection::{ConnectionRegistry, SendToConnectionResult};
use crate::frame::PushFrame;
use crate::message::{
    AcceptedMessage, MessageCreatedEvent, MessageEvent, MessageRecalledEvent, RecalledMessage,
    refresh_message,
};
use crate::node_rpc::{
    EnqueueStatus, ForwardMessageRequest, ForwardRecallRequest, client::NodeRpcClient,
};
use crate::presence::{PresenceManager, RouteState};
use axum::extract::ws::Message;
use serde::Serialize;
use sqlx::MySqlPool;
use std::{future::Future, sync::Arc};

use super::store;

#[derive(Debug, thiserror::Error)]
pub(crate) enum DeliveryError {
    #[error("failed to query current message state: {0}")]
    Message(sqlx::Error),
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
    rpc_client: Arc<NodeRpcClient>,
}

#[derive(Serialize)]
struct MessageCreatedPayload<'a> {
    event_id: &'a str,
    message: &'a AcceptedMessage,
}

#[derive(Serialize)]
struct MessageRecalledPayload<'a> {
    event_id: &'a str,
    #[serde(flatten)]
    message: &'a RecalledMessage,
}

enum DeliveryBody<'a> {
    Created(&'a AcceptedMessage),
    Recalled(&'a RecalledMessage),
}

struct PreparedPush<'a> {
    event_id: &'a str,
    conversation_id: u64,
    message_id: &'a str,
    text: String,
    body: DeliveryBody<'a>,
}

/// Keep reads behind one boundary so no member is enqueued before all reads succeed.
trait DeliveryLookup: Sync {
    fn message(
        &self,
        message: &AcceptedMessage,
    ) -> impl Future<Output = Result<AcceptedMessage, DeliveryError>> + Send;
    fn members(
        &self,
        conversation_id: u64,
    ) -> impl Future<Output = Result<Vec<u64>, DeliveryError>> + Send;
    fn route(&self, user_id: u64)
    -> impl Future<Output = Result<RouteState, DeliveryError>> + Send;
}

impl DeliveryLookup for DeliveryService {
    async fn message(&self, message: &AcceptedMessage) -> Result<AcceptedMessage, DeliveryError> {
        let mut message = message.clone();
        refresh_message(&self.pool, &mut message)
            .await
            .map_err(DeliveryError::Message)?;
        Ok(message)
    }
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
        rpc_client: Arc<NodeRpcClient>,
    ) -> Self {
        Self {
            pool,
            presence,
            connections,
            node_id,
            rpc_client,
        }
    }

    pub(crate) async fn deliver(&self, event: &MessageEvent) -> Result<(), DeliveryError> {
        match event {
            MessageEvent::Created(event) => self.deliver_with_lookup(event, self).await,
            MessageEvent::Recalled(event) => self.deliver_recall_with_lookup(event, self).await,
        }
    }

    async fn deliver_recall_with_lookup(
        &self,
        event: &MessageRecalledEvent,
        lookup: &impl DeliveryLookup,
    ) -> Result<(), DeliveryError> {
        let members = lookup
            .members(event.recalled_message.conversation_id)
            .await?;
        if members.is_empty() {
            return Ok(());
        }
        let text = serde_json::to_string(&PushFrame::new(
            "message_recalled",
            MessageRecalledPayload {
                event_id: &event.event_id,
                message: &event.recalled_message,
            },
        ))?;
        self.fanout(
            PreparedPush {
                event_id: &event.event_id,
                conversation_id: event.recalled_message.conversation_id,
                message_id: &event.recalled_message.message_id,
                text,
                body: DeliveryBody::Recalled(&event.recalled_message),
            },
            members,
            lookup,
        )
        .await
    }

    async fn deliver_with_lookup(
        &self,
        event: &MessageCreatedEvent,
        lookup: &impl DeliveryLookup,
    ) -> Result<(), DeliveryError> {
        // An old Kafka event may outlive its conversation (for example after fixture cleanup).
        // With no active recipients there is no client state to hydrate or deliver.
        let members = lookup.members(event.message.conversation_id).await?;
        if members.is_empty() {
            return Ok(());
        }
        let message = lookup.message(&event.message).await?;
        let frame = PushFrame::new(
            "message_created",
            MessageCreatedPayload {
                event_id: &event.event_id,
                message: &message,
            },
        );
        let text = serde_json::to_string(&frame)?;
        self.fanout(
            PreparedPush {
                event_id: &event.event_id,
                conversation_id: message.conversation_id,
                message_id: &message.message_id,
                text,
                body: DeliveryBody::Created(&message),
            },
            members,
            lookup,
        )
        .await
    }

    async fn fanout(
        &self,
        push: PreparedPush<'_>,
        members: Vec<u64>,
        lookup: &impl DeliveryLookup,
    ) -> Result<(), DeliveryError> {
        let PreparedPush {
            event_id,
            conversation_id,
            message_id,
            text,
            body,
        } = push;
        let mut routes = Vec::with_capacity(members.len());
        for user_id in members {
            routes.push((user_id, lookup.route(user_id).await?));
        }

        // Member and presence reads and frame serialization completed before fanout.
        // Remote address, HTTP and queue failures are best effort; retrying the
        // Kafka event here could duplicate frames already enqueued for other members.
        for (user_id, route) in routes {
            match route {
                RouteState::Offline => tracing::debug!(event_id, user_id, "skip offline recipient"),
                RouteState::Invalid => {
                    tracing::warn!(event_id, user_id, "skip malformed presence route")
                }
                RouteState::Online(route) if route.node_id != self.node_id => {
                    tracing::info!(
                        event_id,
                        message_id,
                        conversation_id,
                        user_id,
                        current_node = %self.node_id,
                        target_node = %route.node_id,
                        connection_id = %route.connection_id,
                        "forwarding message to connection owner"
                    );
                    let result = match &body {
                        DeliveryBody::Created(message) => {
                            self.rpc_client
                                .forward_message(
                                    &route.node_id,
                                    ForwardMessageRequest {
                                        target_user_id: user_id,
                                        connection_id: route.connection_id.clone(),
                                        event_id: event_id.to_owned(),
                                        message: (*message).clone(),
                                    },
                                )
                                .await
                        }
                        DeliveryBody::Recalled(message) => {
                            self.rpc_client
                                .forward_recall(
                                    &route.node_id,
                                    ForwardRecallRequest {
                                        target_user_id: user_id,
                                        connection_id: route.connection_id.clone(),
                                        event_id: event_id.to_owned(),
                                        recalled_message: (*message).clone(),
                                    },
                                )
                                .await
                        }
                    };
                    match result {
                        Ok(EnqueueStatus::Queued) => {}
                        Ok(status) => tracing::warn!(
                            event_id,
                            message_id,
                            conversation_id,
                            user_id,
                            target_node = %route.node_id,
                            connection_id = %route.connection_id,
                            ?status,
                            "remote message was not enqueued"
                        ),
                        Err(error) => tracing::warn!(
                            event_id,
                            message_id,
                            conversation_id,
                            user_id,
                            target_node = %route.node_id,
                            connection_id = %route.connection_id,
                            %error,
                            "remote message forwarding failed"
                        ),
                    }
                }
                RouteState::Online(route) => {
                    let result = self.connections.send_to_connection(
                        user_id,
                        &route.connection_id,
                        Message::Text(text.to_owned().into()),
                    );
                    if result != SendToConnectionResult::Sent {
                        tracing::warn!(
                            event_id,
                            message_id,
                            conversation_id,
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
