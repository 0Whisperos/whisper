# Go 测试组织示例

## 同包测试私有 helper

```go
package verification

import "testing"

func TestNormalizeEmail(t *testing.T) {
	// 测试目标：验证内部邮箱标准化会去除首尾空白并统一域名大小写。
	// 构造方法：直接调用同 package 的未导出 normalizeEmail helper。
	// 输入数据："  Alice@Example.COM  "。
	// 预期行为：返回 "Alice@example.com"。
	got := normalizeEmail("  Alice@Example.COM  ")
	if got != "Alice@example.com" {
		t.Fatalf("normalizeEmail() = %q, want %q", got, "Alice@example.com")
	}
}
```

## 外部 package 测公开契约

```go
package verification_test

import (
	"testing"

	"example.com/project/verification"
)

func TestServiceRejectsEmptyEmail(t *testing.T) {
	// 测试目标：验证消费者通过公开 API 提交空邮箱时得到参数错误。
	// 构造方法：使用公开构造函数创建 Service，并调用 SendCode。
	// 输入数据：email=""，purpose="login"。
	// 预期行为：返回可由公开错误契约识别的无效邮箱错误。
	service := verification.NewService()
	err := service.SendCode(t.Context(), "", "login")
	if err == nil {
		t.Fatal("SendCode() error = nil, want invalid email error")
	}
}
```

## 表驱动测试的逐用例注释

```go
tests := []struct {
	name  string
	input string
	want  string
}{
	// 测试目标：验证普通地址保持本地部分并统一域名大小写。
	// 构造方法：把地址直接传给 normalizeEmail。
	// 输入数据："Alice@Example.COM"。
	// 预期行为：返回 "Alice@example.com"。
	{name: "normalizes domain case", input: "Alice@Example.COM", want: "Alice@example.com"},

	// 测试目标：验证地址首尾空白会被移除。
	// 构造方法：把带空白地址直接传给 normalizeEmail。
	// 输入数据："  alice@example.com  "。
	// 预期行为：返回 "alice@example.com"。
	{name: "trims surrounding spaces", input: "  alice@example.com  ", want: "alice@example.com"},
}

for _, tc := range tests {
	t.Run(tc.name, func(t *testing.T) {
		got := normalizeEmail(tc.input)
		if got != tc.want {
			t.Fatalf("normalizeEmail(%q) = %q, want %q", tc.input, got, tc.want)
		}
	})
}
```

当每个子测试需要完全不同的构造步骤时，不要继续扩张 table 字段；改用独立 `t.Run`，并在各子测试中写四项注释。
