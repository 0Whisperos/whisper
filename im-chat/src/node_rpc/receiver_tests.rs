use super::*;
use crate::connection::ActiveConnection;
use time::OffsetDateTime;
use tokio::sync::mpsc;

fn message() -> AcceptedMessage {
    AcceptedMessage {
        message_id: "message-1".into(),
        conversation_id: 7,
        conversation_seq: 3,
        sender_user_id: 10,
        client_message_id: "client-1".into(),
        message_type: "text".into(),
        content: serde_json::json!({"text": "hello"}),
        created_at: "2026-09-30T00:00:00Z".into(),
    }
}

fn connection(registry: &ConnectionRegistry, capacity: usize) -> mpsc::Receiver<Message> {
    let (sender, receiver) = mpsc::channel(capacity);
    registry.insert(ActiveConnection {
        user_id: 20,
        connection_id: "connection-1".into(),
        connected_at: OffsetDateTime::now_utc(),
        access_token_expires_at: OffsetDateTime::now_utc(),
        sender,
    });
    receiver
}

#[test]
fn forwards_existing_message_frame_to_exact_connection() {
    // 测试目标：验证节点接口复用 message_created 帧并防止连接重建后的误投递。
    // 构造方法：注册用户 20 的 connection-1，先尝试旧连接，再发有效请求。
    // 输入数据：事件 event-1、会话 7 的消息和目标用户 20。
    // 预期行为：旧连接返回 mismatch 且无帧；有效请求返回 queued 且帧字段完整。
    let registry = ConnectionRegistry::new();
    let mut receiver = connection(&registry, 2);
    let mut request = ForwardMessageRequest {
        target_user_id: 20,
        connection_id: "old-connection".into(),
        event_id: "event-1".into(),
        message: message(),
    };
    assert_eq!(
        forward_message(&registry, request.clone()).unwrap(),
        EnqueueStatus::ConnectionIdMismatch
    );
    assert!(receiver.try_recv().is_err());
    request.connection_id = "connection-1".into();
    assert_eq!(
        forward_message(&registry, request).unwrap(),
        EnqueueStatus::Queued
    );
    let Message::Text(text) = receiver.try_recv().unwrap() else {
        panic!("expected text frame")
    };
    let frame: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(frame["type"], "message_created");
    assert_eq!(frame["payload"]["event_id"], "event-1");
    assert_eq!(frame["payload"]["message"]["content"]["text"], "hello");
}

#[test]
fn cursor_notification_only_enqueues_existing_frame() {
    // 测试目标：验证游标接口生成现有回执推送格式，且仅依赖本机连接队列。
    // 构造方法：注册目标连接，直接调用无数据库参数的通知函数。
    // 输入数据：会话 7、用户 10、送达序号 3、已读序号 2。
    // 预期行为：返回 queued，队列收到 conversation_receipt_updated 及对应游标。
    let registry = ConnectionRegistry::new();
    let mut receiver = connection(&registry, 1);
    let request = NotifyCursorRequest {
        target_user_id: 20,
        connection_id: "connection-1".into(),
        conversation_id: 7,
        user_id: 10,
        delivered_seq: 3,
        read_seq: 2,
    };
    assert_eq!(
        notify_cursor(&registry, request).unwrap(),
        EnqueueStatus::Queued
    );
    let Message::Text(text) = receiver.try_recv().unwrap() else {
        panic!("expected text frame")
    };
    let frame: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(frame["type"], "conversation_receipt_updated");
    assert_eq!(
        frame["payload"],
        serde_json::json!({
            "conversation_id": 7,
            "user_id": 10,
            "delivered_seq": 3,
            "read_seq": 2,
        })
    );
}

#[test]
fn reports_missing_full_and_closed_queues() {
    // 测试目标：验证节点响应准确表示连接消失、发送队列满和队列关闭。
    // 构造方法：先使用空注册表，再建立容量为 1 的连接并填满、关闭接收端。
    // 输入数据：连续三次向用户 20 的同一连接投递 event-1。
    // 预期行为：依次返回 no_such_connection、queued、full、closed。
    let registry = ConnectionRegistry::new();
    let request = ForwardMessageRequest {
        target_user_id: 20,
        connection_id: "connection-1".into(),
        event_id: "event-1".into(),
        message: message(),
    };
    assert_eq!(
        forward_message(&registry, request.clone()).unwrap(),
        EnqueueStatus::NoSuchConnection
    );
    let receiver = connection(&registry, 1);
    assert_eq!(
        forward_message(&registry, request.clone()).unwrap(),
        EnqueueStatus::Queued
    );
    assert_eq!(
        forward_message(&registry, request.clone()).unwrap(),
        EnqueueStatus::Full
    );
    drop(receiver);
    assert_eq!(
        forward_message(&registry, request).unwrap(),
        EnqueueStatus::Closed
    );
}
