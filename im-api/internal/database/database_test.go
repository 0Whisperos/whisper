package database

import (
	"errors"
	"reflect"
	"testing"
)

func TestDatabaseOperationsRequireInitialization(t *testing.T) {
	// 测试目标：验证数据库未初始化时，公开数据库操作返回可判定的初始化错误。
	// 构造方法：确保包级数据库连接处于关闭状态，再调用用户查询和认证迁移操作。
	// 输入数据：账号 "00123456"，以及未调用 Open 的全局数据库状态。
	// 预期行为：两个操作均返回可通过 errors.Is 判断的 ErrNotInitialized。
	if err := Close(); err != nil {
		t.Fatalf("Close returned an error: %v", err)
	}

	if _, _, err := FindUserByAccount("00123456"); !errors.Is(err, ErrNotInitialized) {
		t.Fatalf("FindUserByAccount error = %v, want ErrNotInitialized", err)
	}

	if err := MigrateSchema(); !errors.Is(err, ErrNotInitialized) {
		t.Fatalf("MigrateSchema error = %v, want ErrNotInitialized", err)
	}
}

func TestMigrationModelsMatchDatabaseSchemaPlan(t *testing.T) {
	// 测试目标：验证数据库迁移实体清单与文档规划一致，并排除旧 sessions 表。
	// 构造方法：读取 migrationModels 返回的实体，逐个取得显式 TableName。
	// 输入数据：当前 database package 暴露给 AutoMigrate 的实体清单。
	// 预期行为：迁移表只有 users、conversations、conversation_members、messages、outbox_events 和 conversation_member_cursors。
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
