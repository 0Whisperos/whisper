use super::*;
use serde_json::json;

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
