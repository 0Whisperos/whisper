package mysql

import (
	"reflect"
	"sync"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/gorm/schema"
)

func TestMessageReplyColumnIsNullableWithoutAdditionalIndex(t *testing.T) {
	// 测试目标：验证回复关系由现有 messages 表的 nullable CHAR(36) 单列表示。
	// 构造方法：解析正式 Message 的 GORM schema，检查字段及所有索引字段。
	// 输入数据：migrationModels 中使用的 entity.Message 模型。
	// 预期行为：reply_to_message_id 可空且无默认值，不添加外键、撤回列或回复索引。
	model, err := schema.Parse(&entity.Message{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	field := model.LookUpField("ReplyToMessageID")
	if field == nil || field.DBName != "reply_to_message_id" || field.DataType != "char(36)" || field.NotNull || field.HasDefaultValue {
		t.Fatalf("reply column = %#v", field)
	}
	for _, index := range model.ParseIndexes() {
		for _, indexed := range index.Fields {
			if indexed.Field == field {
				t.Fatalf("unexpected reply index %s", index.Name)
			}
		}
	}
	if model.LookUpField("RecalledAt") != nil || len(model.Relationships.Relations) != 0 {
		t.Fatal("reply migration must not add recall columns or foreign keys")
	}
}

func TestMigrationModelsMatchDatabaseSchemaPlan(t *testing.T) {
	// 测试目标：验证数据库迁移实体清单与文档规划一致，并排除旧 sessions 表。
	// 构造方法：读取 migrationModels 返回的实体，逐个取得显式 TableName。
	// 输入数据：当前 mysql package 暴露给 AutoMigrate 的实体清单。
	// 预期行为：迁移表包含用户、好友关系、会话、消息、附件、outbox 和游标表。
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
		"attachments",
		"outbox_events",
		"conversation_member_cursors",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migration tables = %#v, want %#v", got, want)
	}
}
