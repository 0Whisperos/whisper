use super::super::protocol::FriendRequestStatus;
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
        reply_to_message_id: None,
        reply_to: None,
        created_at: "2026-09-30T00:00:00Z".into(),
        recalled_at: None,
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
fn forwards_recall_only_to_exact_connection_with_requestless_payload() {
    // 测试目标：验证跨节点撤回帧定位正确并保留原序号和撤回时间。
    // 构造方法：注册用户 20 的 connection-1，再依次提交旧连接和当前连接请求。
    // 输入数据：event-1、message-1、会话 7、原序号 3 和固定撤回时间。
    // 预期行为：旧连接不入队；当前连接收到不含 request_id 的 message_recalled。
    let registry = ConnectionRegistry::new();
    let mut receiver = connection(&registry, 1);
    let mut request = ForwardRecallRequest {
        target_user_id: 20,
        connection_id: "old".into(),
        event_id: "event-1".into(),
        recalled_message: RecalledMessage {
            message_id: "message-1".into(),
            conversation_id: 7,
            conversation_seq: 3,
            sender_user_id: 10,
            recalled_at: "2026-10-23T12:00:00+08:00".into(),
        },
    };
    assert_eq!(
        forward_recall(&registry, request.clone()).unwrap(),
        EnqueueStatus::ConnectionIdMismatch
    );
    assert!(receiver.try_recv().is_err());
    request.connection_id = "connection-1".into();
    assert_eq!(
        forward_recall(&registry, request).unwrap(),
        EnqueueStatus::Queued
    );
    let Message::Text(text) = receiver.try_recv().unwrap() else {
        panic!("text required")
    };
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["type"], "message_recalled");
    assert!(value.get("request_id").is_none());
    assert_eq!(value["payload"]["conversation_seq"], 3);
    assert_eq!(value["payload"]["recalled_at"], "2026-10-23T12:00:00+08:00");
}

#[test]
fn forwards_existing_message_frame_to_exact_connection() {
    // 测试目标：验证节点接口保留浅层引用原文并防止连接重建后的误投递。
    // 构造方法：注册用户 20 的 connection-1，附加已读取的引用，先尝试旧连接再发送。
    // 输入数据：事件 event-1、会话 7 的回复消息、目标用户 20 和引用正文 original。
    // 预期行为：旧连接返回 mismatch 且无帧；有效请求保留引用 ID、作者、类型和原文。
    let registry = ConnectionRegistry::new();
    let mut receiver = connection(&registry, 2);
    let mut request = ForwardMessageRequest {
        target_user_id: 20,
        connection_id: "old-connection".into(),
        event_id: "event-1".into(),
        message: message(),
    };
    request.message.reply_to_message_id = Some("original-id".to_owned());
    request.message.reply_to = Some(crate::message::ReplyTarget {
        recalled_at: None,
        message_id: "original-id".to_owned(),
        sender_user_id: 20,
        message_type: "rich".to_owned(),
        content: serde_json::json!({"blocks":[{"type":"text","text":"original"}]}),
    });
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
    assert_eq!(
        frame["payload"]["message"]["reply_to_message_id"],
        "original-id"
    );
    assert_eq!(
        frame["payload"]["message"]["reply_to"]["sender_user_id"],
        20
    );
    assert_eq!(
        frame["payload"]["message"]["reply_to"]["message_type"],
        "rich"
    );
    assert_eq!(
        frame["payload"]["message"]["reply_to"]["content"]["blocks"][0]["text"],
        "original"
    );
    assert!(
        frame["payload"]["message"]["reply_to"]
            .get("reply_to")
            .is_none()
    );
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
fn friend_request_notification_targets_the_exact_connection_and_serializes_status() {
    // 测试目标：验证好友申请推送只进入匹配用户和 connection_id 的队列，且状态帧格式稳定。
    // 构造方法：注册用户 20 的 connection-1，先使用旧连接 ID 投递，再向当前连接投递。
    // 输入数据：申请 ID 42、状态 pending、目标用户 20 和连接 connection-1。
    // 预期行为：旧连接返回 connection_id_mismatch 且无帧；当前连接返回 queued 并收到指定字段。
    let registry = ConnectionRegistry::new();
    let mut receiver = connection(&registry, 2);
    let mut request = NotifyFriendRequest {
        target_user_id: 20,
        connection_id: "old-connection".into(),
        request_id: 42,
        status: FriendRequestStatus::Pending,
    };
    assert_eq!(
        notify_friend_request(&registry, request.clone()).unwrap(),
        EnqueueStatus::ConnectionIdMismatch
    );
    assert!(receiver.try_recv().is_err());

    request.connection_id = "connection-1".into();
    assert_eq!(
        notify_friend_request(&registry, request).unwrap(),
        EnqueueStatus::Queued
    );
    let Message::Text(text) = receiver.try_recv().unwrap() else {
        panic!("expected text frame")
    };
    let frame: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(frame["type"], "friend_request_updated");
    assert_eq!(
        frame["payload"],
        serde_json::json!({"request_id": 42, "status": "pending"})
    );
}

#[test]
fn friend_request_notification_reports_missing_and_full_queues() {
    // 测试目标：验证好友申请 RPC 将离线用户和满载队列映射为标准 EnqueueStatus。
    // 构造方法：先向空注册表投递，再注册容量为 1 的连接并填满后再次投递。
    // 输入数据：目标用户 20、申请 ID 43、状态 accepted 和 connection-1。
    // 预期行为：无连接时返回 no_such_connection；队列已满时返回 full，已有队列内容不变。
    let registry = ConnectionRegistry::new();
    let request = NotifyFriendRequest {
        target_user_id: 20,
        connection_id: "connection-1".into(),
        request_id: 43,
        status: FriendRequestStatus::Accepted,
    };
    assert_eq!(
        notify_friend_request(&registry, request.clone()).unwrap(),
        EnqueueStatus::NoSuchConnection
    );
    let mut receiver = connection(&registry, 1);
    assert_eq!(
        notify_friend_request(&registry, request.clone()).unwrap(),
        EnqueueStatus::Queued
    );
    assert_eq!(
        notify_friend_request(&registry, request).unwrap(),
        EnqueueStatus::Full
    );
    assert!(receiver.try_recv().is_ok());
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
