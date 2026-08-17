package model

import "testing"

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
