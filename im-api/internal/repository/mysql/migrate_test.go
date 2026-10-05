package mysql

import (
	"reflect"
	"testing"
)

func TestMigrationModelsMatchDatabaseSchemaPlan(t *testing.T) {
	// 测试目标：验证数据库迁移实体清单与文档规划一致，并排除旧 sessions 表。
	// 构造方法：读取 migrationModels 返回的实体，逐个取得显式 TableName。
	// 输入数据：当前 mysql package 暴露给 AutoMigrate 的实体清单。
	// 预期行为：迁移表包含用户、双向好友、好友申请、会话、成员、消息、outbox 和游标表。
	var got []string
	for _, model := range migrationModels() {
		tableNamer, ok := model.(interface{ TableName() string })
		if !ok {
			t.Fatalf("%T does not define an explicit table name", model)
		}
		got = append(got, tableNamer.TableName())
	}

	want := []string{
		"users",
		"friendships",
		"friend_requests",
		"conversations",
		"conversation_members",
		"messages",
		"outbox_events",
		"conversation_member_cursors",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migration tables = %#v, want %#v", got, want)
	}
}
