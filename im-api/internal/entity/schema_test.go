package entity

import (
	"database/sql/driver"
	"reflect"
	"sync"
	"testing"

	"gorm.io/gorm/schema"
)

func TestPersistentSchemaTablesMatchDatabasePlan(t *testing.T) {
	// 测试目标：验证持久化实体只覆盖数据库规划中的 MySQL 表，不包含旧 sessions 表。
	// 构造方法：实例化迁移实体清单，读取每个实体的 GORM TableName 结果。
	// 输入数据：User、Conversation、ConversationMember、Message、OutboxEvent 和 ConversationMemberCursor 实体。
	// 预期行为：表名精确等于文档规划的 6 张表，且没有 sessions。
	models := []interface{}{
		User{},
		Conversation{},
		ConversationMember{},
		Message{},
		OutboxEvent{},
		ConversationMemberCursor{},
	}
	want := []string{
		"users",
		"conversations",
		"conversation_members",
		"messages",
		"outbox_events",
		"conversation_member_cursors",
	}

	var got []string
	for _, model := range models {
		tableNamer, ok := model.(interface{ TableName() string })
		if !ok {
			t.Fatalf("%T does not define an explicit table name", model)
		}
		got = append(got, tableNamer.TableName())
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("table names = %#v, want %#v", got, want)
	}
}

func TestUserSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 users 实体字段、列类型、头像 object key 可空性和账号唯一键符合数据库规划。
	// 构造方法：解析 User 的 GORM schema，并检查每个字段、avatar_object_key 可空性和 uk_users_account。
	// 输入数据：User 实体类型。
	// 预期行为：id 是 bigint unsigned 自增主键，account 使用 varchar(12)，avatar_object_key 使用 varchar(255) 且允许 NULL。
	parsed := parseSchema(t, User{})

	assertField(t, parsed, "ID", "id", "bigint unsigned", true)
	assertAutoIncrement(t, parsed, "ID", true)
	assertNotNull(t, parsed, "ID", true)
	assertField(t, parsed, "Account", "account", "varchar(12)", false)
	assertNotNull(t, parsed, "Account", true)
	assertField(t, parsed, "PasswordHash", "password_hash", "varchar(60)", false)
	assertNotNull(t, parsed, "PasswordHash", true)
	assertField(t, parsed, "AvatarObjectKey", "avatar_object_key", "varchar(255)", false)
	assertNotNull(t, parsed, "AvatarObjectKey", false)
	assertField(t, parsed, "CreatedAt", "created_at", "datetime(6)", false)
	assertNotNull(t, parsed, "CreatedAt", true)
	assertField(t, parsed, "UpdatedAt", "updated_at", "datetime(6)", false)
	assertNotNull(t, parsed, "UpdatedAt", true)
	assertIndex(t, parsed, "uk_users_account", true, "account")
}

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

func TestOutboxEventSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证 outbox_events 实体采用 Debezium Outbox Event Router 需要的列名和 JSON payload。
	// 构造方法：解析 OutboxEvent 的 GORM schema，并检查主键、列类型和 created_at 索引。
	// 输入数据：OutboxEvent 实体类型。
	// 预期行为：id 为 CHAR(36) 主键，aggregatetype/aggregateid/type 命名不被改成 snake_case，payload 为 JSON。
	parsed := parseSchema(t, OutboxEvent{})

	assertField(t, parsed, "ID", "id", "char(36)", true)
	assertNotNull(t, parsed, "ID", true)
	assertField(t, parsed, "AggregateType", "aggregatetype", "varchar(255)", false)
	assertNotNull(t, parsed, "AggregateType", true)
	assertField(t, parsed, "AggregateID", "aggregateid", "varchar(255)", false)
	assertNotNull(t, parsed, "AggregateID", true)
	assertField(t, parsed, "Type", "type", "varchar(255)", false)
	assertNotNull(t, parsed, "Type", true)
	assertField(t, parsed, "Payload", "payload", "json", false)
	assertNotNull(t, parsed, "Payload", true)
	assertField(t, parsed, "CreatedAt", "created_at", "datetime(6)", false)
	assertNotNull(t, parsed, "CreatedAt", true)
	assertIndex(t, parsed, "idx_outbox_events_created", false, "created_at")
}

func TestRelationshipSchemaMatchesDatabasePlan(t *testing.T) {
	// 测试目标：验证会话、成员关系和成员游标实体的复合主键与索引符合数据库规划。
	// 构造方法：分别解析 Conversation、ConversationMember 和 ConversationMemberCursor 的 GORM schema。
	// 输入数据：Conversation、ConversationMember、ConversationMemberCursor 实体类型。
	// 预期行为：会话 last_seq 使用 bigint unsigned 默认 0；成员和游标表使用文档规定的复合主键。
	conversation := parseSchema(t, Conversation{})
	assertField(t, conversation, "ID", "id", "bigint unsigned", true)
	assertAutoIncrement(t, conversation, "ID", true)
	assertNotNull(t, conversation, "ID", true)
	assertField(t, conversation, "ConversationType", "conversation_type", "varchar(16)", false)
	assertNotNull(t, conversation, "ConversationType", true)
	assertField(t, conversation, "LastSeq", "last_seq", "bigint unsigned", false)
	assertDefault(t, conversation, "LastSeq", "0")
	assertNotNull(t, conversation, "LastSeq", true)
	assertField(t, conversation, "CreatedAt", "created_at", "datetime(6)", false)
	assertNotNull(t, conversation, "CreatedAt", true)
	assertField(t, conversation, "UpdatedAt", "updated_at", "datetime(6)", false)
	assertNotNull(t, conversation, "UpdatedAt", true)

	members := parseSchema(t, ConversationMember{})
	assertField(t, members, "ConversationID", "conversation_id", "bigint unsigned", true)
	assertAutoIncrement(t, members, "ConversationID", false)
	assertNotNull(t, members, "ConversationID", true)
	assertField(t, members, "UserID", "user_id", "bigint unsigned", true)
	assertAutoIncrement(t, members, "UserID", false)
	assertNotNull(t, members, "UserID", true)
	assertField(t, members, "MemberState", "member_state", "varchar(16)", false)
	assertNotNull(t, members, "MemberState", true)
	assertField(t, members, "JoinedAt", "joined_at", "datetime(6)", false)
	assertNotNull(t, members, "JoinedAt", true)
	assertField(t, members, "LeftAt", "left_at", "datetime(6)", false)
	assertNotNull(t, members, "LeftAt", false)
	assertIndex(t, members, "idx_conversation_members_user", false, "user_id", "member_state")

	cursors := parseSchema(t, ConversationMemberCursor{})
	assertField(t, cursors, "ConversationID", "conversation_id", "bigint unsigned", true)
	assertAutoIncrement(t, cursors, "ConversationID", false)
	assertNotNull(t, cursors, "ConversationID", true)
	assertField(t, cursors, "UserID", "user_id", "bigint unsigned", true)
	assertAutoIncrement(t, cursors, "UserID", false)
	assertNotNull(t, cursors, "UserID", true)
	assertField(t, cursors, "DeliveredSeq", "delivered_seq", "bigint unsigned", false)
	assertDefault(t, cursors, "DeliveredSeq", "0")
	assertNotNull(t, cursors, "DeliveredSeq", true)
	assertField(t, cursors, "ReadSeq", "read_seq", "bigint unsigned", false)
	assertDefault(t, cursors, "ReadSeq", "0")
	assertNotNull(t, cursors, "ReadSeq", true)
	assertField(t, cursors, "DeliveredAt", "delivered_at", "datetime(6)", false)
	assertNotNull(t, cursors, "DeliveredAt", false)
	assertField(t, cursors, "ReadAt", "read_at", "datetime(6)", false)
	assertNotNull(t, cursors, "ReadAt", false)
}

func TestJSONValueImplementsDatabaseInterfaces(t *testing.T) {
	// 测试目标：验证 JSON 字段类型能被 database/sql 与 GORM 作为 JSON 列处理。
	// 构造方法：对 JSONValue 做接口断言，并调用 GormDataType 检查通用数据类型。
	// 输入数据：JSONValue(`{"text":"hello"}`)。
	// 预期行为：JSONValue 实现 driver.Valuer，且声明的 GORM 数据类型是 json。
	value := JSONValue(`{"text":"hello"}`)
	if _, ok := interface{}(value).(driver.Valuer); !ok {
		t.Fatal("JSONValue does not implement driver.Valuer")
	}
	if got := value.GormDataType(); got != "json" {
		t.Fatalf("GormDataType = %q, want json", got)
	}
}

func parseSchema(t *testing.T, model interface{}) *schema.Schema {
	t.Helper()

	parsed, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parse schema for %T: %v", model, err)
	}
	return parsed
}

func assertField(t *testing.T, parsed *schema.Schema, fieldName string, columnName string, columnType string, primaryKey bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.DBName != columnName {
		t.Fatalf("%s.%s DBName = %q, want %q", parsed.Name, fieldName, field.DBName, columnName)
	}
	if got := field.TagSettings["TYPE"]; got != columnType {
		t.Fatalf("%s.%s type = %q, want %q", parsed.Name, fieldName, got, columnType)
	}
	if field.PrimaryKey != primaryKey {
		t.Fatalf("%s.%s PrimaryKey = %v, want %v", parsed.Name, fieldName, field.PrimaryKey, primaryKey)
	}
}

func assertAutoIncrement(t *testing.T, parsed *schema.Schema, fieldName string, want bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.AutoIncrement != want {
		t.Fatalf("%s.%s AutoIncrement = %v, want %v", parsed.Name, fieldName, field.AutoIncrement, want)
	}
}

func assertDefault(t *testing.T, parsed *schema.Schema, fieldName string, want string) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.DefaultValue != want {
		t.Fatalf("%s.%s default = %q, want %q", parsed.Name, fieldName, field.DefaultValue, want)
	}
}

func assertNotNull(t *testing.T, parsed *schema.Schema, fieldName string, want bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.NotNull != want {
		t.Fatalf("%s.%s NotNull = %v, want %v", parsed.Name, fieldName, field.NotNull, want)
	}
}

func assertIndex(t *testing.T, parsed *schema.Schema, indexName string, unique bool, columns ...string) {
	t.Helper()

	indexes := parsed.ParseIndexes()
	for _, index := range indexes {
		if index.Name != indexName {
			continue
		}
		if (index.Class == "UNIQUE") != unique {
			t.Fatalf("%s index %s unique = %v, want %v", parsed.Name, indexName, index.Class == "UNIQUE", unique)
		}
		var got []string
		for _, option := range index.Fields {
			got = append(got, option.DBName)
		}
		if !reflect.DeepEqual(got, columns) {
			t.Fatalf("%s index %s columns = %#v, want %#v", parsed.Name, indexName, got, columns)
		}
		return
	}
	t.Fatalf("%s index %s is missing", parsed.Name, indexName)
}
