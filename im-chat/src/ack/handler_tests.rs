use super::*;
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
fn receipt_update_is_a_push_without_request_id() {
    // 测试目标：验证对端回执更新是服务端主动帧，并携带推进游标的成员 ID。
    // 构造方法：直接序列化与线上通知相同的 PushFrame 和 ReceiptUpdatedPayload。
    // 输入数据：conversation_id=42、user_id=20002、delivered_seq=8、read_seq=7。
    // 预期行为：type 为 conversation_receipt_updated，字段和值齐全且 envelope 不含 request_id。
    let frame = PushFrame::new(
        CONVERSATION_RECEIPT_UPDATED,
        ReceiptUpdatedPayload {
            conversation_id: 42,
            user_id: 20002,
            delivered_seq: 8,
            read_seq: 7,
        },
    );

    let value = serde_json::to_value(frame).expect("push frame should serialize");
    assert_eq!(value["type"], CONVERSATION_RECEIPT_UPDATED);
    assert_eq!(value["payload"]["conversation_id"], 42);
    assert_eq!(value["payload"]["user_id"], 20002);
    assert_eq!(value["payload"]["delivered_seq"], 8);
    assert_eq!(value["payload"]["read_seq"], 7);
    assert!(value.get("request_id").is_none());
}
