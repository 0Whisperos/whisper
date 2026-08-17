package response

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNewLoginFormatsDocumentedProtocolFields(t *testing.T) {
	// 测试目标：验证登录响应结构使用 auth 协议需要的 snake_case 字段和协议时间格式。
	// 构造方法：使用固定时区时间创建 Login 响应，并序列化为 JSON。
	// 输入数据：access token、refresh token 和 2026-08-16T12:15:00+08:00。
	// 预期行为：JSON 字段名和 access_token_expires_at 文本与前端协议一致。
	response := NewLogin(
		"jwt-access-token",
		"refresh-token",
		fixedProtocolTime(),
	)

	contents, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal login response: %v", err)
	}
	want := `{"access_token":"jwt-access-token","refresh_token":"refresh-token","access_token_expires_at":"2026-08-16T12:15:00+08:00"}`
	if got := string(contents); got != want {
		t.Fatalf("login response JSON = %s, want %s", got, want)
	}
}

func TestNewRefreshOmitsRefreshToken(t *testing.T) {
	// 测试目标：验证 refresh 响应结构不包含 refresh_token 字段。
	// 构造方法：使用固定时区时间创建 Refresh 响应，并序列化为 JSON。
	// 输入数据：新的 access token 和 2026-08-16T12:15:00+08:00。
	// 预期行为：JSON 只包含 access_token 和 access_token_expires_at。
	response := NewRefresh(
		"new-jwt-access-token",
		fixedProtocolTime(),
	)

	contents, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal refresh response: %v", err)
	}
	want := `{"access_token":"new-jwt-access-token","access_token_expires_at":"2026-08-16T12:15:00+08:00"}`
	if got := string(contents); got != want {
		t.Fatalf("refresh response JSON = %s, want %s", got, want)
	}
}

func TestErrorUsesStableFrontendFields(t *testing.T) {
	// 测试目标：验证统一错误响应结构使用稳定的 error_code 和 message 字段。
	// 构造方法：创建 Error 响应并序列化为 JSON。
	// 输入数据：error_code 为 invalid_request，message 为 invalid request。
	// 预期行为：JSON 不包含 Go 错误文本或内部字段，只包含前端协议字段。
	response := Error{ErrorCode: "invalid_request", Message: "invalid request"}

	contents, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal error response: %v", err)
	}
	want := `{"error_code":"invalid_request","message":"invalid request"}`
	if got := string(contents); got != want {
		t.Fatalf("error response JSON = %s, want %s", got, want)
	}
}

func fixedProtocolTime() time.Time {
	return time.Date(2026, 8, 16, 12, 15, 0, 0, time.FixedZone("CST", 8*60*60))
}
