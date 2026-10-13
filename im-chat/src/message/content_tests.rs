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
fn validate_send_payload_preserves_rich_block_order_and_hashes_attachment_ids() {
    // 测试目标：验证 rich 内容保留文字与图片交错顺序，并把附件 ID 纳入稳定哈希。
    // 构造方法：使用合法 UUID 作为图片块，在两段文字之间交错排列后校验。
    // 输入数据：图片 A、文字“before”、图片 B、文字“after”的 blocks。
    // 预期行为：规范化内容顺序与输入相同，且图片 ID 出现在规范化内容中。
    let mut payload = valid_payload();
    payload.message_type = super::super::RICH.to_string();
    payload.content = json!({ "blocks": [
        { "type": "image", "attachment_id": "550e8400-e29b-41d4-a716-446655440001" },
        { "type": "text", "text": "before" },
        { "type": "image", "attachment_id": "550e8400-e29b-41d4-a716-446655440002" },
        { "type": "text", "text": "after" }
    ] });

    let validated = validate_send_payload(&payload).expect("rich payload should be valid");

    assert_eq!(validated.message_type, super::super::RICH);
    assert_eq!(validated.content, payload.content);
    assert_eq!(
        validated.attachment_ids,
        vec![
            "550e8400-e29b-41d4-a716-446655440001",
            "550e8400-e29b-41d4-a716-446655440002",
        ]
    );
    assert_eq!(validated.content_hash, content_hash(&payload.content));
}

#[test]
fn validate_send_payload_accepts_image_only_rich_message() {
    // 测试目标：验证允许不含文字、只包含图片的 rich 消息。
    // 构造方法：构造一个包含单个合法图片 UUID 的 rich blocks 数组。
    // 输入数据：一个 image block。
    // 预期行为：校验成功并返回一项附件 ID。
    let mut payload = valid_payload();
    payload.message_type = super::super::RICH.to_string();
    payload.content = json!({ "blocks": [
        { "type": "image", "attachment_id": "550e8400-e29b-41d4-a716-446655440001" }
    ] });

    let validated = validate_send_payload(&payload).expect("image-only rich message should pass");

    assert_eq!(validated.attachment_ids.len(), 1);
}

#[test]
fn validate_send_payload_rejects_rich_content_without_visible_content() {
    // 测试目标：验证空 blocks 或仅含空白文字的 rich 消息被拒绝。
    // 构造方法：分别校验空数组和空白 text block 两种无有效内容场景。
    // 输入数据：{ "blocks": [] } 与一个 text="  " 的 blocks。
    // 预期行为：两种输入都返回 InvalidMessage。
    let mut payload = valid_payload();
    payload.message_type = super::super::RICH.to_string();
    for content in [
        json!({ "blocks": [] }),
        json!({ "blocks": [{ "type": "text", "text": "  " }] }),
    ] {
        payload.content = content;
        assert_eq!(
            validate_send_payload(&payload).expect_err("empty rich content should fail"),
            ContentValidationError::InvalidMessage
        );
    }
}

#[test]
fn validate_send_payload_rejects_rich_limits_and_unknown_fields() {
    // 测试目标：验证 rich 消息遵守文字长度、图片数量和严格字段限制。
    // 构造方法：依次提供超长文字、11 张图及带未知字段的 block。
    // 输入数据：文字 4097 字符、11 个合法图片 block、含 extra 字段的图片 block。
    // 预期行为：每种输入均返回 InvalidMessage。
    let image_id = "550e8400-e29b-41d4-a716-446655440001";
    let mut payload = valid_payload();
    payload.message_type = super::super::RICH.to_string();
    let oversized_text =
        json!({ "blocks": [{ "type": "text", "text": "a".repeat(MAX_TEXT_MESSAGE_CHARS + 1) }] });
    let too_many_images = json!({ "blocks": (0..=MAX_RICH_IMAGES).map(|_| json!({ "type": "image", "attachment_id": image_id })).collect::<Vec<_>>() });
    let unknown_field =
        json!({ "blocks": [{ "type": "image", "attachment_id": image_id, "extra": true }] });

    for content in [oversized_text, too_many_images, unknown_field] {
        payload.content = content;
        assert_eq!(
            validate_send_payload(&payload).expect_err("invalid rich content should fail"),
            ContentValidationError::InvalidMessage
        );
    }
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
