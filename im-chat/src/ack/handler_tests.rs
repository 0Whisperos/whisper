use super::*;
use crate::connection::ActiveConnection;
use tokio::sync::mpsc;

#[tokio::test]
async fn delivered_ack_accepted_echoes_request_and_persisted_cursor() {
    // 测试目标：验证 delivered_ack_accepted 使用协议字段并返回格式正确的服务端时间。
    // 构造方法：通过内存 mpsc 队列捕获 send_accepted 生成的 WebSocket 文本帧。
    // 输入数据：request_id=req-delivered、conversation_id=42、服务端游标 delivered_seq=8。
    // 预期行为：响应原样回显 request_id，payload 返回 conversation_id、delivered_seq 和 RFC3339 时间。
    let (sender, mut receiver) = mpsc::channel(1);
    let cursor = Cursor {
        delivered_seq: 8,
        read_seq: 6,
    };
    assert!(
        send_accepted(
            DELIVERED_ACK,
            "req-delivered".to_string(),
            42,
            &cursor,
            "2026-08-16T12:00:02.000Z".to_string(),
            sender,
            20001,
            "connection-1",
        )
        .await
    );

    let Some(Message::Text(text)) = receiver.recv().await else {
        panic!("delivered acknowledgement should be text");
    };
    let value: serde_json::Value =
        serde_json::from_str(text.as_str()).expect("frame should be json");
    assert_eq!(value["type"], DELIVERED_ACK_ACCEPTED);
    assert_eq!(value["request_id"], "req-delivered");
    assert_eq!(value["payload"]["conversation_id"], 42);
    assert_eq!(value["payload"]["delivered_seq"], 8);
    assert_eq!(value["payload"]["delivered_at"], "2026-08-16T12:00:02.000Z");
}

#[tokio::test]
async fn read_ack_accepted_returns_the_current_read_cursor() {
    // 测试目标：验证 read_ack_accepted 不混用送达游标，并保留请求关联 ID。
    // 构造方法：使用内存 mpsc 队列调用 send_accepted 的 read_ack 分支并解析输出 JSON。
    // 输入数据：request_id=req-read、conversation_id=42、cursor.read_seq=7。
    // 预期行为：帧类型为 read_ack_accepted，payload.read_seq=7 且 request_id=req-read。
    let (sender, mut receiver) = mpsc::channel(1);
    let cursor = Cursor {
        delivered_seq: 8,
        read_seq: 7,
    };
    assert!(
        send_accepted(
            READ_ACK,
            "req-read".to_string(),
            42,
            &cursor,
            "2026-08-16T12:00:03.000Z".to_string(),
            sender,
            20001,
            "connection-1",
        )
        .await
    );

    let Some(Message::Text(text)) = receiver.recv().await else {
        panic!("read acknowledgement should be text");
    };
    let value: serde_json::Value =
        serde_json::from_str(text.as_str()).expect("frame should be json");
    assert_eq!(value["type"], READ_ACK_ACCEPTED);
    assert_eq!(value["request_id"], "req-read");
    assert_eq!(value["payload"]["conversation_id"], 42);
    assert_eq!(value["payload"]["read_seq"], 7);
    assert_eq!(value["payload"].get("delivered_seq"), None);
}

#[test]
fn receipt_frame_contains_persisted_cursors() {
    // 测试目标：验证本机回执通知仍构造原协议的服务端推送帧。
    // 构造方法：以已持久化的 Cursor 调用回执帧序列化函数，再解析 JSON。
    // 输入数据：会话 42、确认用户 20001、送达游标 8、已读游标 7。
    // 预期行为：帧类型和两个游标准确，且没有客户端请求 ID。
    let cursor = Cursor {
        delivered_seq: 8,
        read_seq: 7,
    };
    let text = receipt_frame_text(42, 20001, &cursor).expect("receipt frame should serialize");
    let value: serde_json::Value = serde_json::from_str(&text).expect("frame should be json");

    assert_eq!(value["type"], CONVERSATION_RECEIPT_UPDATED);
    assert_eq!(value["payload"]["conversation_id"], 42);
    assert_eq!(value["payload"]["user_id"], 20001);
    assert_eq!(value["payload"]["delivered_seq"], 8);
    assert_eq!(value["payload"]["read_seq"], 7);
    assert!(value.get("request_id").is_none());
}

#[tokio::test]
async fn local_receipt_checks_current_connection_id() {
    // 测试目标：验证本机回执入队仍用路由中的 connection_id 栅栏。
    // 构造方法：注册一个当前连接，用内存 mpsc 队列捕获推送。
    // 输入数据：用户 20002 的当前连接为 new，先尝试旧连接 old，再尝试 new。
    // 预期行为：旧连接不收帧，新连接入队并收到一次回执文本。
    let connections = ConnectionRegistry::new();
    let (sender, mut receiver) = mpsc::channel(2);
    let now = OffsetDateTime::now_utc();
    connections.insert(ActiveConnection {
        user_id: 20002,
        connection_id: "new".to_string(),
        connected_at: now,
        access_token_expires_at: now + time::Duration::hours(1),
        sender,
    });
    let text = receipt_frame_text(
        42,
        20001,
        &Cursor {
            delivered_seq: 8,
            read_seq: 7,
        },
    )
    .expect("receipt frame should serialize");

    assert_eq!(
        enqueue_local_receipt(&connections, 20002, "old", &text),
        SendToConnectionResult::ConnectionIdMismatch
    );
    assert!(receiver.try_recv().is_err());
    assert_eq!(
        enqueue_local_receipt(&connections, 20002, "new", &text),
        SendToConnectionResult::Sent
    );
    let Some(Message::Text(received)) = receiver.recv().await else {
        panic!("receipt update should be text");
    };
    assert_eq!(received.as_str(), text);
}
