use super::*;
use serde_json::json;

#[test]
fn outbox_stores_only_reply_id_and_accepts_old_events() {
    // 测试目标：验证内部事件只保存稳定引用 ID，旧事件无需新增字段仍能读取。
    // 构造方法：从事件 JSON 加入引用 ID 和临时目标内容，再解析并重新序列化。
    // 输入数据：合法引用 UUID 和目标正文 private original。
    // 预期行为：保留引用 ID，不保存 reply_to；删除引用字段后的旧事件校验成功。
    let mut value = serde_json::to_value(event()).unwrap();
    value["message"]["reply_to_message_id"] = json!("550e8400-e29b-41d4-a716-446655440003");
    value["message"]["reply_to"] = json!({
        "message_id":"550e8400-e29b-41d4-a716-446655440003",
        "sender_user_id":20002, "message_type":"text", "content":{"text":"private original"}
    });
    let decoded: MessageCreatedEvent = serde_json::from_value(value).unwrap();
    decoded.validate().unwrap();
    let mut stored = serde_json::to_value(decoded).unwrap();
    assert_eq!(
        stored["message"]["reply_to_message_id"],
        "550e8400-e29b-41d4-a716-446655440003"
    );
    assert!(stored["message"].get("reply_to").is_none());
    stored["message"]
        .as_object_mut()
        .unwrap()
        .remove("reply_to_message_id");
    serde_json::from_value::<MessageCreatedEvent>(stored)
        .unwrap()
        .validate()
        .unwrap();
}

#[test]
fn event_validation_rejects_invalid_reply_uuid() {
    // 测试目标：验证内部事件的无效引用 ID 不会进入投递。
    // 构造方法：在合法事件设置非法引用，直接调用 validate。
    // 输入数据：reply_to_message_id="invalid"。
    // 预期行为：返回明确字段错误，不要求查询数据库。
    let mut event = event();
    event.message.reply_to_message_id = Some("invalid".to_owned());
    assert_eq!(
        event.validate(),
        Err(EventValidationError::InvalidField(
            "message.reply_to_message_id"
        ))
    );
}

fn event() -> MessageCreatedEvent {
    MessageCreatedEvent::new(
        AcceptedMessage {
            message_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
            conversation_id: 10001,
            conversation_seq: 42,
            sender_user_id: 20001,
            client_message_id: "550e8400-e29b-41d4-a716-446655440001".to_owned(),
            message_type: "text".to_owned(),
            content: json!({ "text": "你好" }),
            reply_to_message_id: None,
            reply_to: None,
            created_at: "2026-09-20T12:00:00+08:00".to_owned(),
        },
        "2026-09-20T12:00:00+08:00".to_owned(),
    )
}

#[test]
fn writer_envelope_round_trips_through_consumer_contract() {
    // 测试目标：验证写入 outbox 的统一事件可以被消费端完整读取并校验。
    // 构造方法：通过构造方法生成合法事件，序列化后反序列化并 validate。
    // 输入数据：会话 10001、序号 42、中文文本及 +08:00 时间。
    // 预期行为：所有字段保持一致，aggregate_id 为会话字符串，校验通过。
    let original = event();
    let value = serde_json::to_value(&original).expect("serialize envelope");
    let decoded: MessageCreatedEvent =
        serde_json::from_value(value.clone()).expect("read envelope");
    decoded.validate().expect("valid consumer event");
    assert_eq!(decoded.aggregate_id, "10001");
    assert_eq!(decoded.event_type, "message_created");
    assert_eq!(decoded.aggregate_type, "chat_message");
    assert_eq!(decoded.event_version, 1);
    assert_eq!(serde_json::to_value(decoded).expect("reserialize"), value);
}

#[test]
fn rejects_missing_fields_and_invalid_json() {
    // 测试目标：验证缺少协议必需字段的记录不能进入业务处理。
    // 构造方法：分别从合法事件顶层和 message 中删除每个必需字段，并解析坏 JSON。
    // 输入数据：各个删字段变体以及字节串 "{"。
    // 预期行为：每次反序列化都失败，不产生默认的身份或序号。
    let original = serde_json::to_value(event()).expect("serialize");
    for field in [
        "event_id",
        "event_type",
        "aggregate_type",
        "aggregate_id",
        "event_version",
        "occurred_at",
        "message",
    ] {
        let mut invalid = original.clone();
        invalid.as_object_mut().expect("object").remove(field);
        assert!(
            serde_json::from_value::<MessageCreatedEvent>(invalid).is_err(),
            "missing {field}"
        );
    }
    for field in [
        "message_id",
        "conversation_id",
        "conversation_seq",
        "sender_user_id",
        "client_message_id",
        "message_type",
        "content",
        "created_at",
    ] {
        let mut invalid = original.clone();
        invalid["message"]
            .as_object_mut()
            .expect("object")
            .remove(field);
        assert!(
            serde_json::from_value::<MessageCreatedEvent>(invalid).is_err(),
            "missing message.{field}"
        );
    }
    assert!(serde_json::from_slice::<MessageCreatedEvent>(b"{").is_err());
}

#[test]
fn rejects_unsupported_and_inconsistent_event_fields() {
    // 测试目标：验证未知事件和看似合法 JSON 中的身份、序号、时间或内容错误被拒绝。
    // 构造方法：每轮克隆正常事件，替换一个字段，反序列化后调用 validate。
    // 输入数据：未知类型/版本/聚合，错会话，坏 UUID/时间，零序号/用户，空/超长/非文本正文。
    // 预期行为：所有变体返回字段验证错误。
    let original = serde_json::to_value(event()).expect("serialize");
    for (pointer, replacement) in [
        ("/event_type", json!("unknown")),
        ("/event_version", json!(2)),
        ("/aggregate_type", json!("unknown")),
        ("/aggregate_id", json!("10002")),
        ("/event_id", json!("")),
        ("/occurred_at", json!("today")),
        ("/message/message_id", json!("invalid")),
        ("/message/client_message_id", json!("invalid")),
        ("/message/conversation_seq", json!(0)),
        ("/message/sender_user_id", json!(0)),
        ("/message/created_at", json!("2026-09-20")),
        ("/message/message_type", json!("image")),
        ("/message/content", json!({"text": " "})),
        ("/message/content", json!({"text": "a".repeat(4097)})),
        ("/message/content", json!({"text": 42})),
        (
            "/message/content",
            json!({"text": "hello", "unexpected": true}),
        ),
    ] {
        let mut invalid = original.clone();
        *invalid.pointer_mut(pointer).expect("field exists") = replacement;
        let decoded: MessageCreatedEvent =
            serde_json::from_value(invalid).expect("still valid JSON shape");
        assert!(decoded.validate().is_err(), "invalid field {pointer}");
    }
}

#[test]
fn accepts_text_limit_and_rejects_zero_conversation() {
    // 测试目标：验证消费端继承发送端的文本长度边界和会话 ID 约束。
    // 构造方法：将文本扩展到 4096 个字符，再将聚合和消息会话同步改成零。
    // 输入数据：4096 个汉字、conversation_id=0、aggregate_id="0"。
    // 预期行为：合法长度通过；即使聚合一致，零会话仍不通过。
    let mut event = event();
    event.message.content = json!({ "text": "好".repeat(4096) });
    event.validate().expect("maximum text length accepted");
    event.aggregate_id = "0".to_owned();
    event.message.conversation_id = 0;
    assert!(event.validate().is_err());
}

#[test]
fn accepts_rich_event_without_reordering_blocks_or_exposing_storage_keys() {
    // 测试目标：验证 Kafka/outbox 事件接受 rich blocks，保留编辑顺序并只携带稳定附件 ID。
    // 构造方法：将合法事件改为含图片、文字、图片的 rich 消息后序列化并校验。
    // 输入数据：两个附件 UUID 和位于其间的文本块。
    // 预期行为：事件校验成功，round trip 后 blocks 顺序不变且内容不含 object_key。
    let mut event = event();
    event.message.message_type = "rich".to_owned();
    event.message.content = json!({ "blocks": [
        { "type": "image", "attachment_id": "550e8400-e29b-41d4-a716-446655440002" },
        { "type": "text", "text": "caption" },
        { "type": "image", "attachment_id": "550e8400-e29b-41d4-a716-446655440003" }
    ] });

    event.validate().expect("rich event should be valid");
    let value = serde_json::to_value(&event).expect("serialize rich event");
    let decoded: MessageCreatedEvent = serde_json::from_value(value).expect("decode rich event");
    decoded
        .validate()
        .expect("decoded event should remain valid");
    assert_eq!(decoded.message.content["blocks"][1]["text"], "caption");
    assert!(decoded.message.content.get("object_key").is_none());
}
