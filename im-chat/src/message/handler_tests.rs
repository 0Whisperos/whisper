use super::*;
use serde_json::json;

#[test]
fn accepts_optional_reply_target_without_accepting_client_quote() {
    // 测试目标：验证发送请求接受引用 ID，但不信任客户端提交的目标正文。
    // 构造方法：解析带引用 ID、缺省 ID、显式 null 和额外 reply_to 的请求。
    // 输入数据：合法消息字段、UUID 引用，以及伪造的 reply_to 对象。
    // 预期行为：前三种请求可解析，携带 reply_to 的请求被拒绝。
    let mut value = json!({
        "client_message_id": "550e8400-e29b-41d4-a716-446655440001",
        "conversation_id": 10001, "message_type": "text", "content": {"text":"reply"},
        "reply_to_message_id": "550e8400-e29b-41d4-a716-446655440000"
    });
    assert!(serde_json::from_value::<SendMessagePayload>(value.clone()).is_ok());
    value["reply_to_message_id"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<SendMessagePayload>(value.clone()).is_ok());
    value.as_object_mut().unwrap().remove("reply_to_message_id");
    assert!(serde_json::from_value::<SendMessagePayload>(value.clone()).is_ok());
    value["reply_to"] = json!({"content":{"text":"forged"}});
    assert!(serde_json::from_value::<SendMessagePayload>(value).is_err());
}

#[tokio::test]
async fn send_reject_message_omits_missing_client_message_id() {
    // 测试目标：验证无效 send_message payload 无 client_message_id 时，拒绝响应不会输出 null 字段。
    // 构造方法：直接发送一个 client_message_id=None 的 reject frame 到内存 mpsc 队列。
    // 输入数据：request_id="req-1"，error_code="invalid_message"，client_message_id=None。
    // 预期行为：响应 type 为 send_message_rejected，payload 中不包含 client_message_id。
    let (sender, mut receiver) = mpsc::channel(1);
    let reject = SendMessageReject::invalid(None);

    assert!(send_reject_message(reject, "req-1".to_string(), sender, 20001, "connection-1").await);

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
        reply_to_message_id: None,
        reply_to: None,
        created_at: "2026-08-16T12:00:01Z".to_string(),
    };

    assert!(send_accept_message(message, "req-1".to_string(), sender, 20001, "connection-1").await);

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
    assert_eq!(
        value["payload"]["message"]["reply_to_message_id"],
        serde_json::Value::Null
    );
    assert_eq!(
        value["payload"]["message"]["reply_to"],
        serde_json::Value::Null
    );
}
