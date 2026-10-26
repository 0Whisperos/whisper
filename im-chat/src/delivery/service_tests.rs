use super::*;
use crate::{connection::ActiveConnection, presence::PresenceRoute};
use serde_json::json;
use std::collections::HashMap;
use time::OffsetDateTime;
use tokio::sync::mpsc;

struct Lookup {
    members: Vec<u64>,
    routes: HashMap<u64, RouteState>,
    fail_members: bool,
    fail_route: Option<u64>,
}

struct MissingMessageLookup {
    has_members: bool,
}

impl DeliveryLookup for MissingMessageLookup {
    async fn message(&self, _: &AcceptedMessage) -> Result<AcceptedMessage, DeliveryError> {
        Err(DeliveryError::Message(sqlx::Error::RowNotFound))
    }

    async fn members(&self, _: u64) -> Result<Vec<u64>, DeliveryError> {
        Ok(if self.has_members {
            vec![20001]
        } else {
            vec![]
        })
    }

    async fn route(&self, _: u64) -> Result<RouteState, DeliveryError> {
        panic!("a missing authoritative message must never reach route lookup")
    }
}

#[tokio::test]
async fn obsolete_creation_with_no_members_completes_without_reading_missing_message() {
    // 测试目标：验证无接收者的旧创建事件正常完成，有成员时仍要求读取真实消息状态。
    // 构造方法：让消息读取固定返回 RowNotFound，分别提供空成员集合和一个有效成员。
    // 输入数据：相同旧 message_created、已删除会话或仍有成员的会话。
    // 预期行为：无成员时跳过消息读取并成功；有成员时返回查询错误，不把未知状态当未撤回投递。
    let service = service();
    let mut receiver = connect(&service, 20001, "sender");
    for has_members in [false, true] {
        let result = service
            .deliver_with_lookup(&event(), &MissingMessageLookup { has_members })
            .await;
        assert_eq!(result.is_err(), has_members);
        assert!(receiver.try_recv().is_err());
    }
}

impl DeliveryLookup for Lookup {
    async fn message(&self, message: &AcceptedMessage) -> Result<AcceptedMessage, DeliveryError> {
        let mut message = message.clone();
        if let Some(id) = &message.reply_to_message_id {
            message.reply_to = Some(crate::message::ReplyTarget {
                recalled_at: None,
                message_id: id.clone(),
                sender_user_id: 20002,
                message_type: "text".to_owned(),
                content: json!({"text":"current target"}),
            });
        }
        Ok(message)
    }
    async fn members(&self, _: u64) -> Result<Vec<u64>, DeliveryError> {
        if self.fail_members {
            return Err(DeliveryError::Members(sqlx::Error::PoolClosed));
        }
        Ok(self.members.clone())
    }

    async fn route(&self, user_id: u64) -> Result<RouteState, DeliveryError> {
        if self.fail_route == Some(user_id) {
            return Err(DeliveryError::Presence(
                std::io::Error::from(std::io::ErrorKind::ConnectionRefused).into(),
            ));
        }
        Ok(self
            .routes
            .get(&user_id)
            .cloned()
            .unwrap_or(RouteState::Offline))
    }
}

#[tokio::test]
async fn reply_push_uses_target_loaded_at_delivery_boundary() {
    // 测试目标：验证内部事件不含引用原文时，投递仍使用查询出口补齐的浅层目标。
    // 构造方法：在事件只设置引用 ID，通过可替代查询边界读取目标并捕获本机消息。
    // 输入数据：文本回复、引用 UUID、边界返回作者 20002 和正文 current target。
    // 预期行为：推送保留回复正文，并附带查得的引用 ID、作者、类型和原文。
    let service = service();
    let mut receiver = connect(&service, 20001, "sender");
    let lookup = Lookup {
        members: vec![20001],
        routes: HashMap::from([(20001, local_route("sender"))]),
        fail_members: false,
        fail_route: None,
    };
    let mut event = event();
    let id = "550e8400-e29b-41d4-a716-446655440005";
    event.message.reply_to_message_id = Some(id.to_owned());
    assert!(event.message.reply_to.is_none());
    service.deliver_with_lookup(&event, &lookup).await.unwrap();
    let Message::Text(text) = receiver.try_recv().unwrap() else {
        panic!("text frame")
    };
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["payload"]["message"]["content"]["text"], "hello");
    assert_eq!(value["payload"]["message"]["reply_to_message_id"], id);
    assert_eq!(value["payload"]["message"]["reply_to"]["message_id"], id);
    assert_eq!(
        value["payload"]["message"]["reply_to"]["content"]["text"],
        "current target"
    );
    assert_eq!(
        value["payload"]["message"]["reply_to"]["sender_user_id"],
        20002
    );
}

fn local_route(connection_id: &str) -> RouteState {
    RouteState::Online(PresenceRoute {
        node_id: "node-a".to_owned(),
        connection_id: connection_id.to_owned(),
    })
}

fn service() -> DeliveryService {
    let presence = Arc::new(PresenceManager::new(
        redis::Client::open("redis://127.0.0.1:1/").expect("redis URL"),
    ));
    let rpc_client = Arc::new(NodeRpcClient::new(
        presence.clone(),
        "node-a".to_owned(),
        "test-secret".to_owned(),
    ));
    DeliveryService::new(
        sqlx::mysql::MySqlPoolOptions::new()
            .connect_lazy("mysql://localhost/unused")
            .expect("lazy pool"),
        presence,
        ConnectionRegistry::new(),
        "node-a".to_owned(),
        rpc_client,
    )
}

fn event() -> MessageCreatedEvent {
    serde_json::from_value(json!({
        "event_id": "550e8400-e29b-41d4-a716-446655440000",
        "event_type": "message_created", "event_version": 1,
        "aggregate_type": "chat_message", "aggregate_id": "10001",
        "occurred_at": "2026-09-20T12:00:00+08:00",
        "message": {
            "message_id": "550e8400-e29b-41d4-a716-446655440001",
            "conversation_id": 10001, "conversation_seq": 42, "sender_user_id": 20001,
            "client_message_id": "550e8400-e29b-41d4-a716-446655440002",
            "message_type": "text", "content": { "text": "hello" },
            "created_at": "2026-09-20T12:00:00+08:00"
        }
    }))
    .expect("fixture envelope")
}

fn connect(
    service: &DeliveryService,
    user_id: u64,
    connection_id: &str,
) -> mpsc::Receiver<Message> {
    let (sender, receiver) = mpsc::channel(1);
    service.connections.insert(ActiveConnection {
        user_id,
        connection_id: connection_id.to_owned(),
        connected_at: OffsetDateTime::now_utc(),
        access_token_expires_at: OffsetDateTime::now_utc() + time::Duration::hours(1),
        sender,
    });
    receiver
}

#[tokio::test]
async fn recall_uses_shared_fanout_and_keeps_best_effort_queue_failures() {
    // 测试目标：验证撤回推送复用成员路由并保持队列失败的 best effort 边界。
    // 构造方法：注册本人和接收者连接，并列入不存在连接和离线路由；先模拟预查询失败再正常投递。
    // 输入数据：原序号 42、会话 10001、四个成员和固定撤回时间。
    // 预期行为：预查询失败不向任何成员入队；成功时双方各收到相同撤回帧，缺失/离线连接不阻止完成。
    let service = service();
    let mut sender = connect(&service, 20001, "sender");
    let mut recipient = connect(&service, 20002, "recipient");
    let recalled_message = RecalledMessage {
        message_id: event().message.message_id,
        conversation_id: 10001,
        conversation_seq: 42,
        sender_user_id: 20001,
        recalled_at: "2026-10-23T12:00:00+08:00".into(),
    };
    let event = MessageRecalledEvent {
        event_id: uuid::Uuid::new_v4().to_string(),
        event_type: "message_recalled".into(),
        aggregate_type: "chat_message".into(),
        aggregate_id: "10001".into(),
        event_version: 1,
        occurred_at: recalled_message.recalled_at.clone(),
        recalled_message,
    };
    let mut lookup = Lookup {
        members: vec![20001, 20002, 20003, 20004],
        routes: HashMap::from([
            (20001, local_route("sender")),
            (20002, local_route("recipient")),
            (20003, local_route("missing")),
        ]),
        fail_members: false,
        fail_route: Some(20002),
    };
    assert!(
        service
            .deliver_recall_with_lookup(&event, &lookup)
            .await
            .is_err()
    );
    assert!(sender.try_recv().is_err() && recipient.try_recv().is_err());
    lookup.fail_route = None;
    service
        .deliver_recall_with_lookup(&event, &lookup)
        .await
        .unwrap();
    for receiver in [&mut sender, &mut recipient] {
        let Message::Text(text) = receiver.try_recv().unwrap() else {
            panic!("text required")
        };
        let frame: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(frame["type"], "message_recalled");
        assert_eq!(frame["payload"]["conversation_seq"], 42);
        assert_eq!(frame["payload"]["event_id"], event.event_id);
        assert!(frame.get("request_id").is_none());
    }
}

#[tokio::test]
async fn pushes_to_sender_and_recipient_using_requestless_frame() {
    // 测试目标：验证发送者与接收者都收到正式事件，非会话成员不收到。
    // 构造方法：注册三个本机连接，仅将前两个列为有效成员，通过依赖边界执行完整投递。
    // 输入数据：sender=20001、recipient=20002、non-member=20003、message_created 事件。
    // 预期行为：前两个队列各收到相同 type/payload 且无 request_id，第三个为空。
    let service = service();
    let mut sender = connect(&service, 20001, "sender");
    let mut recipient = connect(&service, 20002, "recipient");
    let mut non_member = connect(&service, 20003, "non-member");
    let lookup = Lookup {
        members: vec![20001, 20002],
        routes: HashMap::from([
            (20001, local_route("sender")),
            (20002, local_route("recipient")),
        ]),
        fail_members: false,
        fail_route: None,
    };
    let event = event();
    service
        .deliver_with_lookup(&event, &lookup)
        .await
        .expect("delivery");
    for receiver in [&mut sender, &mut recipient] {
        let Message::Text(text) = receiver.try_recv().expect("push") else {
            panic!("text frame");
        };
        let value: serde_json::Value = serde_json::from_str(text.as_str()).expect("JSON");
        assert_eq!(value["type"], "message_created");
        assert!(value.get("request_id").is_none());
        assert_eq!(value["payload"]["event_id"], event.event_id);
        assert_eq!(
            value["payload"]["message"],
            serde_json::to_value(&event.message).expect("message")
        );
        assert!(receiver.try_recv().is_err());
    }
    assert!(non_member.try_recv().is_err());
}

#[tokio::test]
async fn finishes_all_reads_before_enqueuing_any_recipient() {
    // 测试目标：验证成员查询失败或后续成员的 Redis 读取失败时，不会先向早期成员投递。
    // 构造方法：注册两连接，让第二条路由读取失败；另一次令成员查询失败。
    // 输入数据：两个有效用户，首个路由正常，第二个模拟 ConnectionRefused。
    // 预期行为：两次均返回错误，两个队列都为空，允许消费者安全重试。
    let service = service();
    let mut sender = connect(&service, 20001, "sender");
    let mut recipient = connect(&service, 20002, "recipient");
    for fail_members in [true, false] {
        let lookup = Lookup {
            members: vec![20001, 20002],
            routes: HashMap::from([
                (20001, local_route("sender")),
                (20002, local_route("recipient")),
            ]),
            fail_members,
            fail_route: Some(20002),
        };
        assert!(
            service
                .deliver_with_lookup(&event(), &lookup)
                .await
                .is_err()
        );
        assert!(sender.try_recv().is_err());
        assert!(recipient.try_recv().is_err());
    }
}

#[tokio::test]
async fn skips_unavailable_routes_and_continues_after_queue_failures() {
    // 测试目标：验证离线、损坏、远端、stale、满队列和关闭队列不会阻止正常成员收消息。
    // 构造方法：创建八名成员和对应路由，预填满一个队列、关闭另一个，最后保留正常连接。
    // 输入数据：offline=1、invalid=2、remote=3、missing=4、stale=5、full=6、closed=7、online=8。
    // 预期行为：本轮返回成功，只有正常成员产生新推送；其余无错误或额外入队。
    let service = service();
    let mut remote = connect(&service, 3, "remote");
    let mut stale = connect(&service, 5, "new");
    let mut full = connect(&service, 6, "full");
    let closed = connect(&service, 7, "closed");
    drop(closed);
    let mut online = connect(&service, 8, "online");
    assert_eq!(
        service
            .connections
            .send_to_connection(6, "full", Message::Text("existing".into())),
        SendToConnectionResult::Sent
    );
    let lookup = Lookup {
        members: (1..=8).collect(),
        routes: HashMap::from([
            (2, RouteState::Invalid),
            (
                3,
                RouteState::Online(PresenceRoute {
                    node_id: "node-b".to_owned(),
                    connection_id: "remote".to_owned(),
                }),
            ),
            (4, local_route("missing")),
            (5, local_route("old")),
            (6, local_route("full")),
            (7, local_route("closed")),
            (8, local_route("online")),
        ]),
        fail_members: false,
        fail_route: None,
    };
    service
        .deliver_with_lookup(&event(), &lookup)
        .await
        .expect("decision finished");
    assert!(remote.try_recv().is_err());
    assert!(stale.try_recv().is_err());
    let Message::Text(text) = full.try_recv().expect("existing item") else {
        panic!("text");
    };
    assert_eq!(text.as_str(), "existing");
    assert!(full.try_recv().is_err());
    assert!(online.try_recv().is_ok());
}

#[derive(Clone)]
struct CapturedLog(Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for CapturedLog {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log lock").extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLog {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[tokio::test]
async fn remote_route_logs_identifiers_without_chat_body() {
    // 测试目标：验证远端分支日志包含转发定位字段且不泄露聊天正文。
    // 构造方法：为投递 future 安装独立 tracing subscriber，提供一条远端路由并捕获输出。
    // 输入数据：node-a 到 node-b、用户 20002、connection-remote 和特定消息正文。
    // 预期行为：日志包含全部事件/消息/会话/用户/节点/连接 ID，不包含正文。
    use tracing::instrument::WithSubscriber;
    let service = service();
    let mut event = event();
    event.message.content = json!({ "text": "private-chat-body-must-not-be-logged" });
    let lookup = Lookup {
        members: vec![20002],
        routes: HashMap::from([(
            20002,
            RouteState::Online(PresenceRoute {
                node_id: "node-b".to_owned(),
                connection_id: "connection-remote".to_owned(),
            }),
        )]),
        fail_members: false,
        fail_route: None,
    };
    let bytes = Arc::new(std::sync::Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_writer(CapturedLog(bytes.clone()))
        .finish();
    service
        .deliver_with_lookup(&event, &lookup)
        .with_subscriber(subscriber)
        .await
        .expect("remote decision finished");
    let output = String::from_utf8(bytes.lock().expect("log lock").clone()).expect("UTF-8 logs");
    for expected in [
        event.event_id.as_str(),
        event.message.message_id.as_str(),
        "10001",
        "20002",
        "node-a",
        "node-b",
        "connection-remote",
    ] {
        assert!(
            output.contains(expected),
            "missing log field {expected}: {output}"
        );
    }
    assert!(!output.contains("private-chat-body-must-not-be-logged"));
}
