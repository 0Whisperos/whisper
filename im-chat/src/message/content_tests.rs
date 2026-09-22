use super::*;
use serde_json::json;

fn valid_payload() -> SendMessagePayload {
    SendMessagePayload {
        client_message_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        conversation_id: 10001,
        message_type: TEXT.to_string(),
        content: json!({ "text": "hello" }),
        client_sent_at: Some("2026-08-16T12:00:00Z".to_string()),
    }
}

#[test]
fn validate_send_payload_accepts_and_normalizes_text_content() {
    // 测试目标：验证合法 text 消息会被规范化，并生成稳定的内容哈希。
    // 构造方法：构造完整 send_message payload，调用 validate_send_payload。
    // 输入数据：UUID client_message_id、conversation_id=10001、content={ "text": "hello" }。
    // 预期行为：返回 message_type=text，content 保留原文，hash 与规范化 JSON 的 SHA-256 一致。
    let payload = valid_payload();

    let validated = validate_send_payload(&payload).expect("text payload should be valid");

    assert_eq!(validated.message_type, TEXT);
    assert_eq!(validated.content, json!({ "text": "hello" }));
    assert_eq!(
        validated.content_hash,
        "cbbbdcd27692344de5dbab3abcaba413fb0f45307267de7081401576df1cb176"
    );
}

#[test]
fn validate_send_payload_rejects_unknown_message_type() {
    // 测试目标：验证第一阶段只允许 text 消息类型。
    // 构造方法：把合法 payload 的 message_type 改为 image。
    // 输入数据：message_type="image"，content={ "text": "hello" }。
    // 预期行为：返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.message_type = "image".to_string();

    let error = validate_send_payload(&payload).expect_err("image should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}

#[test]
fn validate_send_payload_rejects_blank_text() {
    // 测试目标：验证去首尾空白后为空的 text 消息会被拒绝。
    // 构造方法：把合法 payload 的 content.text 改为空白字符串。
    // 输入数据：content={ "text": "   " }。
    // 预期行为：返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.content = json!({ "text": "   " });

    let error = validate_send_payload(&payload).expect_err("blank text should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}

#[test]
fn validate_send_payload_rejects_too_long_text() {
    // 测试目标：验证超过 4096 个字符的 text 消息会被拒绝。
    // 构造方法：生成 4097 个字符并放入 content.text。
    // 输入数据：content.text 为 "a" 重复 4097 次。
    // 预期行为：返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.content = json!({ "text": "a".repeat(MAX_TEXT_MESSAGE_CHARS + 1) });

    let error = validate_send_payload(&payload).expect_err("too long text should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}

#[test]
fn validate_send_payload_rejects_extra_content_field() {
    // 测试目标：验证 text content 不允许未知额外字段。
    // 构造方法：在 content 中加入 text 之外的 extra 字段。
    // 输入数据：content={ "text": "hello", "extra": true }。
    // 预期行为：返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.content = json!({ "text": "hello", "extra": true });

    let error = validate_send_payload(&payload).expect_err("extra field should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}

#[test]
fn validate_send_payload_rejects_invalid_client_sent_at() {
    // 测试目标：验证存在但格式非法的 client_sent_at 会被拒绝。
    // 构造方法：把合法 payload 的 client_sent_at 改为非 RFC3339 文本。
    // 输入数据：client_sent_at="not-a-time"。
    // 预期行为：返回 InvalidMessage，且不会继续进入数据库写入。
    let mut payload = valid_payload();
    payload.client_sent_at = Some("not-a-time".to_string());

    let error = validate_send_payload(&payload).expect_err("invalid time should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}

#[test]
fn validate_send_payload_rejects_invalid_client_message_id() {
    // 测试目标：验证 client_message_id 必须是带连字符的 UUID 文本。
    // 构造方法：把合法 payload 的 client_message_id 改为普通字符串。
    // 输入数据：client_message_id="client-1"。
    // 预期行为：返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.client_message_id = "client-1".to_string();

    let error = validate_send_payload(&payload).expect_err("invalid id should be rejected");

    assert_eq!(error, ContentValidationError::InvalidMessage);
}
