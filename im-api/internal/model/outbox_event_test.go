package model

import "testing"

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
