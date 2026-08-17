package entity

import "testing"

func TestMessageSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 messages 实体的字段、列类型、唯一键和查询索引符合数据库规划。
	// 构造方法：解析 Message 的 GORM schema，并按字段名检查标签配置。
	// 输入数据：Message 实体类型。
	// 预期行为：message_id、conversation_seq、sender/client 幂等唯一键和 JSON content 列均按文档定义。
	parsed := parseSchema(t, Message{})

	assertField(t, parsed, "ID", "id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "ID", true)
	assertNotNull(t, parsed, "ID", true)
	assertField(t, parsed, "MessageID", "message_id", "char(36)", false)
	assertNotNull(t, parsed, "MessageID", true)
	assertField(t, parsed, "ConversationID", "conversation_id", "bigint unsigned", false)
	assertNotNull(t, parsed, "ConversationID", true)
	assertField(t, parsed, "ConversationSeq", "conversation_seq", "bigint unsigned", false)
	assertNotNull(t, parsed, "ConversationSeq", true)
	assertField(t, parsed, "SenderUserID", "sender_user_id", "bigint unsigned", false)
	assertNotNull(t, parsed, "SenderUserID", true)
	assertField(t, parsed, "ClientMessageID", "client_message_id", "char(36)", false)
	assertNotNull(t, parsed, "ClientMessageID", true)
	assertField(t, parsed, "MessageType", "message_type", "varchar(32)", false)
	assertNotNull(t, parsed, "MessageType", true)
	assertField(t, parsed, "Content", "content", "json", false)
	assertNotNull(t, parsed, "Content", true)
	assertField(t, parsed, "ContentHash", "content_hash", "char(64)", false)
	assertNotNull(t, parsed, "ContentHash", true)
	assertField(t, parsed, "CreatedAt", "created_at", "datetime(6)", false)
	assertNotNull(t, parsed, "CreatedAt", true)

	assertIndex(t, parsed, "uk_messages_message_id", true, "message_id")
	assertIndex(t, parsed, "uk_messages_conversation_seq", true, "conversation_id", "conversation_seq")
	assertIndex(t, parsed, "uk_messages_sender_client_msg", true, "sender_user_id", "client_message_id")
	assertIndex(t, parsed, "idx_messages_conversation_created", false, "conversation_id", "created_at")
}
