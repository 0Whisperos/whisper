package entity

import "testing"

func TestConversationSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 conversations 实体字段、列类型和默认值符合数据库规划。
	// 构造方法：解析 Conversation 的 GORM schema，并检查主键、类型、last_seq 和时间字段。
	// 输入数据：Conversation 实体类型。
	// 预期行为：会话 last_seq 使用 bigint unsigned 默认 0，时间字段不可空。
	parsed := parseSchema(t, Conversation{})

	assertField(t, parsed, "ID", "id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "ID", true)
	assertNotNull(t, parsed, "ID", true)
	assertField(t, parsed, "ConversationType", "conversation_type", "varchar(16)", false)
	assertNotNull(t, parsed, "ConversationType", true)
	assertField(t, parsed, "LastSeq", "last_seq", "bigint unsigned", false)
	assertDefault(t, parsed, "LastSeq", "0")
	assertNotNull(t, parsed, "LastSeq", true)
	assertField(t, parsed, "CreatedAt", "created_at", "datetime(6)", false)
	assertNotNull(t, parsed, "CreatedAt", true)
	assertField(t, parsed, "UpdatedAt", "updated_at", "datetime(6)", false)
	assertNotNull(t, parsed, "UpdatedAt", true)
}

func TestConversationMemberSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 conversation_members 实体的复合主键和用户查询索引符合数据库规划。
	// 构造方法：解析 ConversationMember 的 GORM schema，并检查字段、主键和 idx_conversation_members_user。
	// 输入数据：ConversationMember 实体类型。
	// 预期行为：conversation_id/user_id 为复合主键，user_id/member_state 有普通索引。
	parsed := parseSchema(t, ConversationMember{})

	assertField(t, parsed, "ConversationID", "conversation_id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "ConversationID", false)
	assertNotNull(t, parsed, "ConversationID", true)
	assertField(t, parsed, "UserID", "user_id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "UserID", false)
	assertNotNull(t, parsed, "UserID", true)
	assertField(t, parsed, "MemberState", "member_state", "varchar(16)", false)
	assertNotNull(t, parsed, "MemberState", true)
	assertField(t, parsed, "JoinedAt", "joined_at", "datetime(6)", false)
	assertNotNull(t, parsed, "JoinedAt", true)
	assertField(t, parsed, "LeftAt", "left_at", "datetime(6)", false)
	assertNotNull(t, parsed, "LeftAt", false)
	assertIndex(t, parsed, "idx_conversation_members_user", false, "user_id", "member_state")
}

func TestConversationMemberCursorSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 conversation_member_cursors 实体的复合主键和默认游标值符合数据库规划。
	// 构造方法：解析 ConversationMemberCursor 的 GORM schema，并检查字段、主键、默认值和可空时间。
	// 输入数据：ConversationMemberCursor 实体类型。
	// 预期行为：conversation_id/user_id 为复合主键，delivered_seq/read_seq 默认 0。
	parsed := parseSchema(t, ConversationMemberCursor{})

	assertField(t, parsed, "ConversationID", "conversation_id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "ConversationID", false)
	assertNotNull(t, parsed, "ConversationID", true)
	assertField(t, parsed, "UserID", "user_id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "UserID", false)
	assertNotNull(t, parsed, "UserID", true)
	assertField(t, parsed, "DeliveredSeq", "delivered_seq", "bigint unsigned", false)
	assertDefault(t, parsed, "DeliveredSeq", "0")
	assertNotNull(t, parsed, "DeliveredSeq", true)
	assertField(t, parsed, "ReadSeq", "read_seq", "bigint unsigned", false)
	assertDefault(t, parsed, "ReadSeq", "0")
	assertNotNull(t, parsed, "ReadSeq", true)
	assertField(t, parsed, "DeliveredAt", "delivered_at", "datetime(6)", false)
	assertNotNull(t, parsed, "DeliveredAt", false)
	assertField(t, parsed, "ReadAt", "read_at", "datetime(6)", false)
	assertNotNull(t, parsed, "ReadAt", false)
}
