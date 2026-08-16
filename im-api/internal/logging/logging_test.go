package logging

import (
	"bytes"
	"strings"
	"testing"
)

func TestInfoWritesActualCallerSource(t *testing.T) {
	// 测试目标：验证全局 Info 日志记录时间、级别、消息和实际业务调用位置。
	// 构造方法：将包级日志输出重置到内存缓冲区，再从当前测试函数调用 Info。
	// 输入数据：消息 "global logging test" 及字段 "component=database"。
	// 预期行为：文本日志包含时间、INFO、消息、字段和本测试文件的 source 信息。
	var output bytes.Buffer
	initLogger(&output)

	Info("global logging test", "component", "database")

	text := output.String()
	for _, expected := range []string{
		"time=",
		"level=INFO",
		"msg=\"global logging test\"",
		"component=database",
		"source=",
		"logging_test.go",
	} {
		if !strings.Contains(text, expected) {
			t.Errorf("log output %q does not contain %q", text, expected)
		}
	}
}
