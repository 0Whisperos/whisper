package database

import (
	"errors"
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

	if err := MigrateAuthentication(); !errors.Is(err, ErrNotInitialized) {
		t.Fatalf("MigrateAuthentication error = %v, want ErrNotInitialized", err)
	}
}
