package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func TestWriteErrorUsesAuthMappingsAndSafeFallback(t *testing.T) {
	// 测试目标：验证 auth 领域错误和未知错误都映射为稳定 error_code/message 响应。
	// 构造方法：直接调用通用错误响应函数，传入 auth 错误映射表。
	// 输入数据：auth.ErrInvalidCredentials、auth.ErrInvalidRefreshToken 和普通 Go 错误。
	// 预期行为：响应状态和 error_code 符合当前 auth 协议，且未知错误不泄漏内部文本。
	gin.SetMode(gin.TestMode)
	testCases := []struct {
		name       string
		err        error
		statusCode int
		body       string
	}{
		{
			name:       "invalid credentials",
			err:        auth.ErrInvalidCredentials,
			statusCode: http.StatusUnauthorized,
			body:       `{"error_code":"invalid_credentials","message":"account or password is incorrect"}`,
		},
		{
			name:       "invalid refresh token",
			err:        auth.ErrInvalidRefreshToken,
			statusCode: http.StatusUnauthorized,
			body:       `{"error_code":"invalid_refresh_token","message":"invalid refresh token"}`,
		},
		{
			name:       "no available chat node",
			err:        auth.ErrNoAvailableChatNode,
			statusCode: http.StatusServiceUnavailable,
			body:       `{"error_code":"no_available_chat_node","message":"no available chat node"}`,
		},
		{
			name:       "internal error",
			err:        errors.New("database unavailable"),
			statusCode: http.StatusInternalServerError,
			body:       `{"error_code":"internal_error","message":"internal error"}`,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			// 测试目标：验证当前错误场景会写入安全稳定的 HTTP 错误响应。
			// 构造方法：创建 gin 测试 context 并调用 writeError。
			// 输入数据：当前子测试的 err 和 authErrorMappings。
			// 预期行为：状态码和响应体等于期望值，未知错误正文不包含内部错误文本。
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)

			handled := writeError(context, testCase.err, authErrorMappings...)

			if !handled {
				t.Fatal("writeError returned false")
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

func TestLoginReturnsInvalidRequestForMalformedJSON(t *testing.T) {
	// 测试目标：验证无法解析的登录 JSON 遵守 invalid_request 公开错误码契约。
	// 构造方法：创建测试路由并向登录地址发送语法错误的 JSON 请求体。
	// 输入数据：Content-Type 为 application/json，正文为 {invalid-json。
	// 预期行为：响应状态为 400，正文为 error_code invalid_request。
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/auth/login", Login)
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

func TestRegisterReturnsCreatedAccount(t *testing.T) {
	// 测试目标：验证注册 handler 将合法请求转发给注册服务，并返回 201 和生成的账号。
	// 构造方法：注入注册服务替身，创建 gin 路由后发送 JSON 注册请求。
	// 输入数据：nickname=张三、password=secret，注册服务返回账号 00123456。
	// 预期行为：响应状态为 201，正文只包含 account 字段，不包含密码或 token。
	oldRegisterAuth := registerAuth
	registerAuth = func(nickname string, password string) (string, error) {
		if nickname != "张三" || password != "secret" {
			t.Fatalf("register input = %q/%q, want 张三/secret", nickname, password)
		}
		return "00123456", nil
	}
	t.Cleanup(func() { registerAuth = oldRegisterAuth })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/auth/register", Register)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"nickname":"张三","password":"secret"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}
	if got := recorder.Body.String(); got != `{"account":"00123456"}` {
		t.Fatalf("body = %s, want account-only response", got)
	}
}

func TestRegisterReturnsInvalidRequestForMalformedJSON(t *testing.T) {
	// 测试目标：验证注册 handler 对无法解析的 JSON 返回稳定的 invalid_request 错误。
	// 构造方法：创建注册路由并发送 Content-Type 为 application/json 的语法错误请求体。
	// 输入数据：请求正文 {invalid-json。
	// 预期行为：响应状态为 400，正文使用 auth 协议规定的 invalid_request 错误码。
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/auth/register", Register)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader("{invalid-json"))
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

func TestRegisterHidesUnexpectedServiceError(t *testing.T) {
	// 测试目标：验证注册服务发生未知错误时，handler 返回安全的 internal_error 而不泄漏内部文本。
	// 构造方法：注入返回数据库连接细节的注册服务替身，再发送合法 JSON 请求。
	// 输入数据：nickname=张三、password=secret，服务错误为 database password leaked。
	// 预期行为：响应状态为 500，正文只包含稳定 internal_error，且不出现内部错误文本。
	oldRegisterAuth := registerAuth
	registerAuth = func(string, string) (string, error) {
		return "", errors.New("database password leaked")
	}
	t.Cleanup(func() { registerAuth = oldRegisterAuth })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/auth/register", Register)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"nickname":"张三","password":"secret"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if strings.Contains(recorder.Body.String(), "database password leaked") || recorder.Body.String() != `{"error_code":"internal_error","message":"internal error"}` {
		t.Fatalf("body = %s, want safe internal_error", recorder.Body.String())
	}
}
