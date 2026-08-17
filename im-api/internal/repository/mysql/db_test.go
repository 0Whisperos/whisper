package mysql

import (
	"errors"
	"strings"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/config"
)

func TestDatabaseOperationsRequireInitialization(t *testing.T) {
	// 测试目标：验证数据库未初始化时，公开数据库操作返回可判定的初始化错误。
	// 构造方法：确保包级数据库连接处于关闭状态，再调用用户查询和迁移操作。
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

func TestBuildDSNUsesStructuredDatabaseConfig(t *testing.T) {
	// 测试目标：验证 MySQL DSN 由结构化 database 配置字段生成。
	// 构造方法：构造包含 host、port、账号、库名和超时参数的 DatabaseConfig，并调用 buildDSN。
	// 输入数据：host=127.0.0.1，port=3306，username=whisper，name=whisper，charset=utf8mb4。
	// 预期行为：DSN 包含 tcp(host:port)、库名和必要查询参数，不要求用户手写 DSN。
	dsn := buildDSN(config.DatabaseConfig{
		Host:         "127.0.0.1",
		Port:         3306,
		Username:     "whisper",
		Password:     "root",
		Name:         "whisper",
		Charset:      "utf8mb4",
		ParseTime:    true,
		Loc:          "Local",
		Timeout:      "5s",
		ReadTimeout:  "5s",
		WriteTimeout: "5s",
	})

	for _, want := range []string{
		"whisper:root@tcp(127.0.0.1:3306)/whisper?",
		"charset=utf8mb4",
		"parseTime=true",
		"loc=Local",
		"timeout=5s",
		"readTimeout=5s",
		"writeTimeout=5s",
	} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("dsn = %q, want it to contain %q", dsn, want)
		}
	}
}
