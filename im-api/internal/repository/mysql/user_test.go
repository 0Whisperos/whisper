package mysql

import (
	"errors"
	"testing"

	mysqldriver "github.com/go-sql-driver/mysql"
)

func TestIsDuplicateKeyErrorRecognizesMySQLDuplicateError(t *testing.T) {
	// 测试目标：验证仓储层能识别 MySQL 1062 唯一键冲突并转换为注册重试所需的稳定条件。
	// 构造方法：构造一个 MySQL 驱动的 1062 错误，并通过 fmt.Errorf 包装后传入识别函数。
	// 输入数据：MySQLError.Number=1062，错误文本为 duplicate entry。
	// 预期行为：识别函数返回 true，且错误包装不影响判断。
	err := errors.New("duplicate entry")
	mysqlError := &mysqldriver.MySQLError{Number: 1062, Message: err.Error()}
	wrappedError := errors.Join(errors.New("create user"), mysqlError)

	if !isDuplicateKeyError(wrappedError) {
		t.Fatal("isDuplicateKeyError returned false for MySQL error 1062")
	}
}

func TestIsDuplicateKeyErrorRejectsOtherMySQLErrors(t *testing.T) {
	// 测试目标：验证仓储层不会把非唯一键数据库错误误判为账号冲突。
	// 构造方法：构造一个 MySQL 驱动的非 1062 错误并传入识别函数。
	// 输入数据：MySQLError.Number=1064，错误文本为 syntax error。
	// 预期行为：识别函数返回 false，调用方应将该错误作为内部错误处理。
	err := &mysqldriver.MySQLError{Number: 1064, Message: "syntax error"}

	if isDuplicateKeyError(err) {
		t.Fatal("isDuplicateKeyError returned true for MySQL error 1064")
	}
}
