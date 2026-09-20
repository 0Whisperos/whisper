mod content;
mod event;
mod store;

pub(crate) use event::{EventValidationError, MessageCreatedEvent};

use crate::frame::{self, Frame};
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use tokio::sync::mpsc;

pub(crate) const SEND_MESSAGE: &str = "send_message";
const SERVER_ACCEPTED: &str = "server_accepted";
const SEND_MESSAGE_REJECTED: &str = "send_message_rejected";
pub(super) const INVALID_MESSAGE: &str = "invalid_message";
pub(super) const CONVERSATION_NOT_FOUND: &str = "conversation_not_found";
pub(super) const NOT_CONVERSATION_MEMBER: &str = "not_conversation_member";
pub(super) const DUPLICATE_CLIENT_MESSAGE_CONFLICT: &str = "duplicate_client_message_conflict";
pub(super) const INTERNAL_ERROR: &str = "internal_error";
pub(super) const TEXT: &str = "text";

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
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn send_reject_message_omits_missing_client_message_id() {
        // 测试目标：验证无效 send_message payload 无 client_message_id 时，拒绝响应不会输出 null 字段。
        // 构造方法：直接发送一个 client_message_id=None 的 reject frame 到内存 mpsc 队列。
        // 输入数据：request_id="req-1"，error_code="invalid_message"，client_message_id=None。
        // 预期行为：响应 type 为 send_message_rejected，payload 中不包含 client_message_id。
        let (sender, mut receiver) = mpsc::channel(1);
        let reject = SendMessageReject::invalid(None);

        assert!(
            send_reject_message(reject, "req-1".to_string(), sender, 20001, "connection-1").await
        );

        let Some(Message::Text(text)) = receiver.recv().await else {
            panic!("send_message reject response should be text");
        };
        let value: serde_json::Value =
            serde_json::from_str(text.as_str()).expect("reject response should be json");
        assert_eq!(value["type"], SEND_MESSAGE_REJECTED);
        assert_eq!(value["request_id"], "req-1");
        assert_eq!(value["payload"]["error_code"], INVALID_MESSAGE);
        assert!(value["payload"].get("client_message_id").is_none());
    }

    #[tokio::test]
    async fn send_accept_message_uses_protocol_frame_shape() {
        // 测试目标：验证 server_accepted 响应包含协议约定的 type、request_id 和 message payload。
        // 构造方法：构造 AcceptedMessage 并通过内存 mpsc 队列捕获发送出的 WebSocket 文本。
        // 输入数据：message_id="message-1"，client_message_id="client-1"，request_id="req-1"。
        // 预期行为：响应 type 为 server_accepted，payload.client_message_id 与 message 内字段一致。
        let (sender, mut receiver) = mpsc::channel(1);
        let message = AcceptedMessage {
            message_id: "message-1".to_string(),
            conversation_id: 10001,
            conversation_seq: 1,
            sender_user_id: 20001,
            client_message_id: "client-1".to_string(),
            message_type: TEXT.to_string(),
            content: json!({ "text": "hello" }),
            created_at: "2026-08-16T12:00:01Z".to_string(),
        };

        assert!(
            send_accept_message(message, "req-1".to_string(), sender, 20001, "connection-1").await
        );

        let Some(Message::Text(text)) = receiver.recv().await else {
            panic!("send_message accept response should be text");
        };
        let value: serde_json::Value =
            serde_json::from_str(text.as_str()).expect("accept response should be json");
        assert_eq!(value["type"], SERVER_ACCEPTED);
        assert_eq!(value["request_id"], "req-1");
        assert_eq!(value["payload"]["client_message_id"], "client-1");
        assert_eq!(value["payload"]["message"]["client_message_id"], "client-1");
        assert_eq!(value["payload"]["message"]["content"]["text"], "hello");
    }
}
