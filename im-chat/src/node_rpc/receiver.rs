//! Receives authenticated node requests and enqueues existing WebSocket frames.

use super::protocol::{
    EnqueueStatus, ForwardMessageRequest, NotifyCursorRequest, NotifyFriendRequest,
};
use crate::connection::ConnectionRegistry;
use crate::frame::PushFrame;
use crate::message::AcceptedMessage;
use axum::extract::ws::Message;
use serde::Serialize;

#[derive(Serialize)]
struct MessageCreatedPayload<'a> {
    event_id: &'a str,
    message: &'a AcceptedMessage,
}

#[derive(Serialize)]
struct ReceiptUpdatedPayload {
    conversation_id: u64,
    user_id: u64,
    delivered_seq: u64,
    read_seq: u64,
}

#[derive(Serialize)]
struct FriendRequestUpdatedPayload {
    request_id: u64,
    status: super::protocol::FriendRequestStatus,
}

pub(crate) fn forward_message(
    connections: &ConnectionRegistry,
    request: ForwardMessageRequest,
) -> Result<EnqueueStatus, serde_json::Error> {
    let frame = PushFrame::new(
        "message_created",
        MessageCreatedPayload {
            event_id: &request.event_id,
            message: &request.message,
        },
    );
    enqueue(
        connections,
        request.target_user_id,
        &request.connection_id,
        &frame,
    )
}

pub(crate) fn notify_cursor(
    connections: &ConnectionRegistry,
    request: NotifyCursorRequest,
) -> Result<EnqueueStatus, serde_json::Error> {
    let frame = PushFrame::new(
        "conversation_receipt_updated",
        ReceiptUpdatedPayload {
            conversation_id: request.conversation_id,
            user_id: request.user_id,
            delivered_seq: request.delivered_seq,
            read_seq: request.read_seq,
        },
    );
    enqueue(
        connections,
        request.target_user_id,
        &request.connection_id,
        &frame,
    )
}

pub(crate) fn notify_friend_request(
    connections: &ConnectionRegistry,
    request: NotifyFriendRequest,
) -> Result<EnqueueStatus, serde_json::Error> {
    let frame = PushFrame::new(
        "friend_request_updated",
        FriendRequestUpdatedPayload {
            request_id: request.request_id,
            status: request.status,
        },
    );
    enqueue(
        connections,
        request.target_user_id,
        &request.connection_id,
        &frame,
    )
}

fn enqueue<T: Serialize>(
    connections: &ConnectionRegistry,
    user_id: u64,
    connection_id: &str,
    frame: &PushFrame<T>,
) -> Result<EnqueueStatus, serde_json::Error> {
    let text = serde_json::to_string(frame)?;
    Ok(connections
        .send_to_connection(user_id, connection_id, Message::Text(text.into()))
        .into())
}

#[cfg(test)]
#[path = "receiver_tests.rs"]
mod tests;
