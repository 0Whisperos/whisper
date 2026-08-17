package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func TestLoginHandlerReturnsDocumentedTokenResponse(t *testing.T) {
	// 测试目标：验证登录接口返回 auth-protocol.md 规定的 snake_case token 响应。
	// 构造方法：注入 fake AuthService，并向 /v1/auth/login 发送合法 JSON。
	// 输入数据：账号 12345678、密码 secret。
	// 预期行为：响应为 200，字段包含 access_token、refresh_token、access_token_expires_at、im_chat_ws_url。
	gin.SetMode(gin.TestMode)
	router := newAuthTestRouter()
	router.POST("/v1/auth/login", LoginHandler(fakeLoginFunc(
		auth.AuthResult{
			AccessToken:          "jwt-access-token",
			RefreshToken:         "refresh-token",
			AccessTokenExpiresAt: fixedTestTime(),
			IMChatWSURL:          "ws://127.0.0.1:9001/ws",
		},
		nil,
	)))
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(`{"account":"12345678","password":"secret"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	want := `{"access_token":"jwt-access-token","refresh_token":"refresh-token","access_token_expires_at":"2026-08-16T12:15:00+08:00","im_chat_ws_url":"ws://127.0.0.1:9001/ws"}`
	if got := recorder.Body.String(); got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
}

func TestRefreshHandlerReturnsAccessTokenWithoutRefreshToken(t *testing.T) {
	// 测试目标：验证 refresh 接口只返回新的 access token，不轮换 refresh token。
	// 构造方法：注入 fake AuthService，并向 /v1/auth/refresh 发送 refresh_token JSON。
	// 输入数据：refresh_token raw-refresh-token。
	// 预期行为：响应为 200，正文不包含 refresh_token 字段。
	gin.SetMode(gin.TestMode)
	router := newAuthTestRouter()
	router.POST("/v1/auth/refresh", RefreshHandler(fakeRefreshFunc(
		auth.AuthResult{
			AccessToken:          "new-jwt-access-token",
			AccessTokenExpiresAt: fixedTestTime(),
			IMChatWSURL:          "ws://127.0.0.1:9001/ws",
		},
		nil,
	)))
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/refresh", strings.NewReader(`{"refresh_token":"raw-refresh-token"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	want := `{"access_token":"new-jwt-access-token","access_token_expires_at":"2026-08-16T12:15:00+08:00","im_chat_ws_url":"ws://127.0.0.1:9001/ws"}`
	if got := recorder.Body.String(); got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
}

func TestLogoutHandlerDeletesRefreshTokenFromBody(t *testing.T) {
	// 测试目标：验证 logout 接口从 JSON body 读取 refresh_token 并返回 204。
	// 构造方法：注入 fake AuthService，发送 POST /v1/auth/logout。
	// 输入数据：refresh_token raw-refresh-token。
	// 预期行为：fake service 收到该 refresh token，响应为 204 No Content。
	gin.SetMode(gin.TestMode)
	var logoutToken string
	router := newAuthTestRouter()
	router.POST("/v1/auth/logout", LogoutHandler(func(_ context.Context, refreshToken string) error {
		logoutToken = refreshToken
		return nil
	}))
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", strings.NewReader(`{"refresh_token":"raw-refresh-token"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if logoutToken != "raw-refresh-token" {
		t.Fatalf("logout token = %q, want raw-refresh-token", logoutToken)
	}
}

func TestAuthErrorsUseDocumentedErrorCodeBody(t *testing.T) {
	// 测试目标：验证 auth 领域错误和未知错误都映射为稳定 error_code/message 响应。
	// 构造方法：分别调用统一错误映射函数，传入凭据错误、无 chat 节点和普通内部错误。
	// 输入数据：auth.ErrInvalidCredentials、auth.ErrNoAvailableChatNode、errors.New("database unavailable")。
	// 预期行为：响应状态和 error_code 符合 auth-protocol.md，且内部错误文本不泄漏。
	gin.SetMode(gin.TestMode)
	testCases := []struct {
		name       string
		err        error
		statusCode int
		body       string
	}{
		// 测试目标：验证凭据错误返回统一认证失败响应。
		// 构造方法：向错误映射函数传入 auth.ErrInvalidCredentials。
		// 输入数据：auth.ErrInvalidCredentials。
		// 预期行为：响应为 401 invalid_credentials。
		{name: "invalid credentials", err: auth.ErrInvalidCredentials, statusCode: http.StatusUnauthorized, body: `{"error_code":"invalid_credentials","message":"account or password is incorrect"}`},
		// 测试目标：验证无可用聊天节点返回服务不可用响应。
		// 构造方法：向错误映射函数传入 auth.ErrNoAvailableChatNode。
		// 输入数据：auth.ErrNoAvailableChatNode。
		// 预期行为：响应为 503 no_available_chat_node。
		{name: "no available chat node", err: auth.ErrNoAvailableChatNode, statusCode: http.StatusServiceUnavailable, body: `{"error_code":"no_available_chat_node","message":"no available chat node"}`},
		// 测试目标：验证未知错误不暴露具体错误内容。
		// 构造方法：向错误映射函数传入普通 Go 错误。
		// 输入数据：errors.New("database unavailable")。
		// 预期行为：响应为 500 internal_error，正文不包含 database unavailable。
		{name: "internal error", err: errors.New("database unavailable"), statusCode: http.StatusInternalServerError, body: `{"error_code":"internal_error","message":"internal error"}`},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)

			handled := writeAuthError(context, testCase.err)

			if !handled {
				t.Fatal("writeAuthError returned false")
			}
			if recorder.Code != testCase.statusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, testCase.statusCode)
			}
			if got := recorder.Body.String(); got != testCase.body {
				t.Fatalf("body = %s, want %s", got, testCase.body)
			}
			if strings.Contains(recorder.Body.String(), "database unavailable") {
				t.Fatal("response leaked internal error text")
			}
		})
	}
}

func TestLoginHandlerReturnsInvalidRequestForMalformedJSON(t *testing.T) {
	// 测试目标：验证无法解析的登录 JSON 遵循 invalid_request 公开错误码契约。
	// 构造方法：创建默认路由并向登录地址发送语法错误的 JSON 请求体。
	// 输入数据：Content-Type 为 application/json，正文为 {invalid-json。
	// 预期行为：响应状态为 400，正文为 error_code invalid_request。
	gin.SetMode(gin.TestMode)
	router := newAuthTestRouter()
	router.POST("/v1/auth/login", LoginHandler(fakeLoginFunc(auth.AuthResult{}, nil)))
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader("{invalid-json"))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if got := recorder.Body.String(); got != `{"error_code":"invalid_request","message":"invalid request"}` {
		t.Fatalf("body = %s, want invalid_request", got)
	}
}

func fakeLoginFunc(result auth.AuthResult, err error) LoginFunc {
	return func(_ context.Context, _ string, _ string) (auth.AuthResult, error) {
		return result, err
	}
}

func fakeRefreshFunc(result auth.AuthResult, err error) RefreshFunc {
	return func(_ context.Context, _ string) (auth.AuthResult, error) {
		return result, err
	}
}

func newAuthTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func fixedTestTime() time.Time {
	return time.Date(2026, 8, 16, 12, 15, 0, 0, time.FixedZone("CST", 8*60*60))
}
