use super::store::{self, AckError, AckKind, Cursor};
use crate::connection::ConnectionRegistry;
use crate::frame::{self, Frame, PushFrame};
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::mpsc;

pub(crate) const DELIVERED_ACK: &str = "delivered_ack";
pub(crate) const READ_ACK: &str = "read_ack";
const DELIVERED_ACK_ACCEPTED: &str = "delivered_ack_accepted";
const READ_ACK_ACCEPTED: &str = "read_ack_accepted";
const DELIVERED_ACK_REJECTED: &str = "delivered_ack_rejected";
const READ_ACK_REJECTED: &str = "read_ack_rejected";
const CONVERSATION_RECEIPT_UPDATED: &str = "conversation_receipt_updated";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AckPayload {
    conversation_id: u64,
    #[serde(default)]
    delivered_seq: Option<u64>,
    #[serde(default)]
    read_seq: Option<u64>,
}

#[derive(Serialize)]
struct DeliveredAckAcceptedPayload {
    conversation_id: u64,
    delivered_seq: u64,
    delivered_at: String,
}

#[derive(Serialize)]
struct ReadAckAcceptedPayload {
    conversation_id: u64,
    read_seq: u64,
    read_at: String,
}

#[derive(Serialize)]
struct AckRejectedPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation_id: Option<u64>,
    error_code: &'static str,
    message: &'static str,
}

#[derive(Serialize)]
struct ReceiptUpdatedPayload {
    conversation_id: u64,
    user_id: u64,
    delivered_seq: u64,
    read_seq: u64,
}

pub(crate) async fn handle_frame(
    raw_frame: Frame<serde_json::Value>,
    pool: &MySqlPool,
    connections: &ConnectionRegistry,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: &str,
) -> bool {
    let request_id = raw_frame.request_id;
    let frame_type = raw_frame.frame_type;
    let conversation_id = raw_frame
        .payload
        .get("conversation_id")
        .and_then(|value| value.as_u64());
    let payload = match serde_json::from_value::<AckPayload>(raw_frame.payload) {
        Ok(payload) => payload,
        Err(_) => {
            return send_rejected(
                frame_type.as_str(),
                request_id,
                conversation_id,
                "invalid_message",
                "invalid acknowledgement",
                write_tx,
                user_id,
                connection_id,
            )
            .await;
        }
    };
    let kind = match frame_type.as_str() {
        DELIVERED_ACK if payload.delivered_seq.is_some() && payload.read_seq.is_none() => {
            AckKind::Delivered
        }
        READ_ACK if payload.read_seq.is_some() && payload.delivered_seq.is_none() => AckKind::Read,
        _ => {
            return send_rejected(
                frame_type.as_str(),
                request_id,
                Some(payload.conversation_id),
                "invalid_message",
                "invalid acknowledgement",
                write_tx,
                user_id,
                connection_id,
            )
            .await;
        }
    };
    let sequence = match kind {
        AckKind::Delivered => payload.delivered_seq.unwrap_or_default(),
        AckKind::Read => payload.read_seq.unwrap_or_default(),
    };
    match store::acknowledge(pool, user_id, payload.conversation_id, sequence, kind).await {
        Ok(cursor) => {
            let now = OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .expect("UTC acknowledgement timestamps should format as RFC3339");
            let response_sent = send_accepted(
                frame_type.as_str(),
                request_id,
                payload.conversation_id,
                &cursor,
                now,
                write_tx,
                user_id,
                connection_id,
            )
            .await;
            notify_other_members(pool, connections, user_id, payload.conversation_id, cursor).await;
            response_sent
        }
        Err(error) => {
            let (code, message) = match error {
                AckError::ConversationNotFound => {
                    ("conversation_not_found", "conversation not found")
                }
                AckError::NotConversationMember => (
                    "not_conversation_member",
                    "current user is not an active member of the conversation",
                ),
                AckError::CursorOutOfRange => (
                    "cursor_out_of_range",
                    "acknowledgement cursor is out of range",
                ),
                AckError::Sql(error) => {
                    tracing::warn!(%error, user_id, conversation_id = payload.conversation_id, "failed to persist acknowledgement");
                    ("internal_error", "internal error")
                }
            };
            send_rejected(
                frame_type.as_str(),
                request_id,
                Some(payload.conversation_id),
                code,
                message,
                write_tx,
                user_id,
                connection_id,
            )
            .await
        }
    }
}

async fn send_accepted(
    request_type: &str,
    request_id: String,
    conversation_id: u64,
    cursor: &Cursor,
    acknowledged_at: String,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: &str,
) -> bool {
    match request_type {
        DELIVERED_ACK => {
            let frame = Frame::new(
                DELIVERED_ACK_ACCEPTED.to_string(),
                request_id,
                DeliveredAckAcceptedPayload {
                    conversation_id,
                    delivered_seq: cursor.delivered_seq,
                    delivered_at: acknowledged_at,
                },
            );
            send_text(
                DELIVERED_ACK_ACCEPTED,
                &frame,
                write_tx,
                user_id,
                connection_id,
            )
            .await
        }
        _ => {
            let frame = Frame::new(
                READ_ACK_ACCEPTED.to_string(),
                request_id,
                ReadAckAcceptedPayload {
                    conversation_id,
                    read_seq: cursor.read_seq,
                    read_at: acknowledged_at,
                },
            );
            send_text(READ_ACK_ACCEPTED, &frame, write_tx, user_id, connection_id).await
        }
    }
}

async fn send_rejected(
    request_type: &str,
    request_id: String,
    conversation_id: Option<u64>,
    error_code: &'static str,
    message: &'static str,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: &str,
) -> bool {
    let frame_type = if request_type == DELIVERED_ACK {
        DELIVERED_ACK_REJECTED
    } else {
        READ_ACK_REJECTED
    };
    let frame = Frame::new(
        frame_type.to_string(),
        request_id,
        AckRejectedPayload {
            conversation_id,
            error_code,
            message,
        },
    );
    send_text(frame_type, &frame, write_tx, user_id, connection_id).await
}

async fn send_text<T: Serialize>(
    frame_type: &str,
    frame: &Frame<T>,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: &str,
) -> bool {
    let text = match frame::to_text(frame) {
        Ok(text) => text,
        Err(error) => {
            tracing::warn!(%error, user_id, %connection_id, %frame_type, "failed to serialize acknowledgement response");
            return false;
        }
    };
    if let Err(error) = write_tx.send(Message::Text(text.into())).await {
        tracing::debug!(%error, user_id, %connection_id, %frame_type, "acknowledgement response queue closed");
        return false;
    }
    true
}

async fn notify_other_members(
    pool: &MySqlPool,
    connections: &ConnectionRegistry,
    acking_user_id: u64,
    conversation_id: u64,
    cursor: Cursor,
) {
    let members: Vec<u64> = match sqlx::query_scalar(
        "SELECT user_id FROM conversation_members \
         WHERE conversation_id = ? AND member_state = 'active' AND user_id <> ?",
    )
    .bind(conversation_id)
    .bind(acking_user_id)
    .fetch_all(pool)
    .await
    {
        Ok(members) => members,
        Err(error) => {
            tracing::warn!(%error, conversation_id, "failed to load receipt recipients");
            return;
        }
    };
    let frame = PushFrame::new(
        CONVERSATION_RECEIPT_UPDATED,
        ReceiptUpdatedPayload {
            conversation_id,
            user_id: acking_user_id,
            delivered_seq: cursor.delivered_seq,
            read_seq: cursor.read_seq,
        },
    );
    let Ok(text) = serde_json::to_string(&frame) else {
        return;
    };
    for member_id in members {
        let Some(connection) = connections.get(member_id) else {
            continue;
        };
        let result = connections.send_to_connection(
            member_id,
            &connection.connection_id,
            Message::Text(text.clone().into()),
        );
        if result != crate::connection::SendToConnectionResult::Sent {
            tracing::debug!(
                conversation_id,
                member_id,
                ?result,
                "receipt update was not enqueued"
            );
        }
    }
}

#[cfg(test)]
#[path = "handler_tests.rs"]
mod tests;
