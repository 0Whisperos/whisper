package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func TestNewAllowsConfiguredOriginPreflight(t *testing.T) {
	// 测试目标：验证已配置来源可以通过登录接口的 CORS 预检。
	// 构造方法：以允许来源创建路由，并构造携带 Origin 和预检请求头的 OPTIONS 请求。
	// 输入数据：来源 http://127.0.0.1:1420，请求路径 /v1/auth/login，方法 POST。
	// 预期行为：响应为 204，且 Access-Control-Allow-Origin 等于该允许来源。
	gin.SetMode(gin.TestMode)
	origin := "http://127.0.0.1:1420"
	engine := New(Config{AllowedOrigins: []string{origin}, Login: fakeLoginFunc(auth.AuthResult{}, nil)})
	request := httptest.NewRequest(http.MethodOptions, "/v1/auth/login", nil)
	request.Header.Set("Origin", origin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, origin)
	}
}

func TestNewDoesNotAllowUnknownOrigin(t *testing.T) {
	// 测试目标：验证未配置来源不能获得跨域访问授权。
	// 构造方法：以单个允许来源创建路由，再从另一个来源发起 OPTIONS 预检。
	// 输入数据：允许来源 http://127.0.0.1:1420，实际来源 http://example.invalid。
	// 预期行为：响应不包含 Access-Control-Allow-Origin，未知来源不能被浏览器授权。
	gin.SetMode(gin.TestMode)
	engine := New(Config{AllowedOrigins: []string{"http://127.0.0.1:1420"}, Login: fakeLoginFunc(auth.AuthResult{}, nil)})
	request := httptest.NewRequest(http.MethodOptions, "/v1/auth/login", nil)
	request.Header.Set("Origin", "http://example.invalid")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func fakeLoginFunc(result auth.AuthResult, err error) func(context.Context, string, string) (auth.AuthResult, error) {
	return func(context.Context, string, string) (auth.AuthResult, error) {
		return result, err
	}
}
