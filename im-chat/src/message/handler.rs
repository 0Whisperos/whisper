use super::store;

use crate::frame::{self, Frame};
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use tokio::sync::mpsc;

pub(crate) const SEND_MESSAGE: &str = "send_message";
const SERVER_ACCEPTED: &str = "server_accepted";
const SEND_MESSAGE_REJECTED: &str = "send_message_rejected";
pub(crate) const INVALID_MESSAGE: &str = "invalid_message";
pub(crate) const CONVERSATION_NOT_FOUND: &str = "conversation_not_found";
pub(crate) const NOT_CONVERSATION_MEMBER: &str = "not_conversation_member";
pub(crate) const DUPLICATE_CLIENT_MESSAGE_CONFLICT: &str = "duplicate_client_message_conflict";
pub(crate) const INTERNAL_ERROR: &str = "internal_error";
pub(crate) const TEXT: &str = "text";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SendMessagePayload {
    pub(crate) client_message_id: String,
    pub(crate) conversation_id: u64,
    pub(crate) message_type: String,
    pub(crate) content: serde_json::Value,
    #[serde(default)]
    pub(crate) client_sent_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct AcceptedMessage {
    pub(crate) message_id: String,
    pub(crate) conversation_id: u64,
    pub(crate) conversation_seq: u64,
    pub(crate) sender_user_id: u64,
    pub(crate) client_message_id: String,
    pub(crate) message_type: String,
    pub(crate) content: serde_json::Value,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ServerAcceptedPayload {
    pub(crate) client_message_id: String,
    pub(crate) message: AcceptedMessage,
}

#[derive(Debug, Serialize)]
pub(crate) struct SendMessageReject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) client_message_id: Option<String>,
    pub(crate) error_code: &'static str,
    pub(crate) message: &'static str,
}

pub(crate) async fn handle_frame(
    raw_frame: Frame<serde_json::Value>,
    pool: &MySqlPool,
    write_tx: mpsc::Sender<Message>,
    sender_user_id: u64,
    connection_id: &str,
) -> bool {
    let request_id = raw_frame.request_id.clone();
    let client_message_id = raw_frame
        .payload
        .get("client_message_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let payload = match serde_json::from_value::<SendMessagePayload>(raw_frame.payload) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::debug!(
                %error,
                sender_user_id,
                %connection_id,
                "reject invalid send_message payload"
            );
            let reject = SendMessageReject::invalid(client_message_id);
            return send_reject_message(
                reject,
                request_id,
                write_tx,
                sender_user_id,
                connection_id,
            )
            .await;
        }
    };

    match accept_message(pool, sender_user_id, payload).await {
        Ok(message) => {
            send_accept_message(message, request_id, write_tx, sender_user_id, connection_id).await
        }
        Err(reject) => {
            send_reject_message(reject, request_id, write_tx, sender_user_id, connection_id).await
        }
    }
}

async fn send_accept_message(
    message: AcceptedMessage,
    request_id: String,
    write_tx: mpsc::Sender<Message>,
    sender_user_id: u64,
    connection_id: &str,
) -> bool {
    let payload = ServerAcceptedPayload {
        client_message_id: message.client_message_id.clone(),
        message,
    };
    let frame = Frame::new(SERVER_ACCEPTED.to_string(), request_id, payload);
    send_response_frame(
        &frame,
        write_tx,
        sender_user_id,
        connection_id,
        SERVER_ACCEPTED,
    )
    .await
}

async fn send_reject_message(
    reject: SendMessageReject,
    request_id: String,
    write_tx: mpsc::Sender<Message>,
    sender_user_id: u64,
    connection_id: &str,
) -> bool {
    let frame = Frame::new(SEND_MESSAGE_REJECTED.to_string(), request_id, reject);
    send_response_frame(
        &frame,
        write_tx,
        sender_user_id,
        connection_id,
        SEND_MESSAGE_REJECTED,
    )
    .await
}

async fn send_response_frame<T>(
    frame: &Frame<T>,
    write_tx: mpsc::Sender<Message>,
    sender_user_id: u64,
    connection_id: &str,
    response_type: &str,
) -> bool
where
    T: Serialize,
{
    let text = match frame::to_text(frame) {
        Ok(text) => text,
        Err(error) => {
            tracing::warn!(
                %error,
                sender_user_id,
                %connection_id,
                %response_type,
                "failed to serialize send_message response frame"
            );
            return false;
        }
    };
    if let Err(error) = write_tx.send(Message::Text(text.into())).await {
        tracing::debug!(
            %error,
            sender_user_id,
            %connection_id,
            %response_type,
            "send_message response writer queue closed"
        );
        return false;
    }
    true
}

impl SendMessageReject {
    fn invalid(client_message_id: Option<String>) -> Self {
        Self {
            client_message_id,
            error_code: INVALID_MESSAGE,
            message: "invalid message",
        }
    }
}

async fn accept_message(
    pool: &MySqlPool,
    sender_user_id: u64,
    payload: SendMessagePayload,
) -> Result<AcceptedMessage, SendMessageReject> {
    let client_message_id = payload.client_message_id.clone();
    match store::accept_message(pool, sender_user_id, payload).await {
        Ok(message) => Ok(message),
        Err(error) => {
            tracing::debug!(
                %error,
                sender_user_id,
                client_message_id = %client_message_id,
                "reject send_message"
            );
            Err(error.into_reject(Some(client_message_id)))
        }
    }
}

#[cfg(test)]
#[path = "handler_tests.rs"]
mod tests;
