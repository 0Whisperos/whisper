package serve

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/auth"
	"github.com/gin-gonic/gin"
)

func TestNewRouterAllowsConfiguredOriginPreflight(t *testing.T) {
	// 测试目标：验证已配置来源可以通过登录接口的 CORS 预检。
	// 构造方法：以允许来源创建路由，并构造携带 Origin 和预检请求头的 OPTIONS 请求。
	// 输入数据：来源 http://127.0.0.1:1420，请求路径 /v1/auth/login，方法 POST。
	// 预期行为：响应为 204，且 Access-Control-Allow-Origin 等于该允许来源。
	gin.SetMode(gin.TestMode)
	origin := "http://127.0.0.1:1420"
	router := NewRouter([]string{origin})
	request := httptest.NewRequest(http.MethodOptions, "/v1/auth/login", nil)
	request.Header.Set("Origin", origin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type, Authorization")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, origin)
	}
}

func TestNewRouterDoesNotAllowUnknownOrigin(t *testing.T) {
	// 测试目标：验证未配置来源不能获得跨域访问授权。
	// 构造方法：以单个允许来源创建路由，再从另一个来源发起 OPTIONS 预检。
	// 输入数据：允许来源 http://127.0.0.1:1420，实际来源 http://example.invalid。
	// 预期行为：响应不包含 Access-Control-Allow-Origin，未知来源不能被浏览器授权。
	gin.SetMode(gin.TestMode)
	router := NewRouter([]string{"http://127.0.0.1:1420"})
	request := httptest.NewRequest(http.MethodOptions, "/v1/auth/login", nil)
	request.Header.Set("Origin", "http://example.invalid")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestWriteLoginErrorUsesPublicErrorCodes(t *testing.T) {
	// 测试目标：验证登录领域错误和未知错误都映射为稳定的公开 HTTP 错误码。
	// 构造方法：分别向统一错误映射函数传入无效请求、凭据错误和普通内部错误。
	// 输入数据：auth.ErrInvalidRequest、auth.ErrInvalidCredentials 与 errors.New("database unavailable")。
	// 预期行为：依次返回 400 invalid_request、401 invalid_credentials、500 internal_error。
	gin.SetMode(gin.TestMode)
	testCases := []struct {
		name       string
		err        error
		statusCode int
		body       string
	}{
		// 测试目标：验证无效请求错误不会泄漏内部信息。
		// 构造方法：向错误映射函数传入 auth.ErrInvalidRequest。
		// 输入数据：auth.ErrInvalidRequest。
		// 预期行为：响应为 400 和 invalid_request。
		{
			name:       "invalid request",
			err:        auth.ErrInvalidRequest,
			statusCode: http.StatusBadRequest,
			body:       `{"error":"invalid_request"}`,
		},
		// 测试目标：验证凭据错误返回统一的认证失败结果。
		// 构造方法：向错误映射函数传入 auth.ErrInvalidCredentials。
		// 输入数据：auth.ErrInvalidCredentials。
		// 预期行为：响应为 401 和 invalid_credentials。
		{
			name:       "invalid credentials",
			err:        auth.ErrInvalidCredentials,
			statusCode: http.StatusUnauthorized,
			body:       `{"error":"invalid_credentials"}`,
		},
		// 测试目标：验证未知错误不暴露具体错误内容。
		// 构造方法：向错误映射函数传入普通 Go 错误。
		// 输入数据：errors.New("database unavailable")。
		// 预期行为：响应为 500 和 internal_error。
		{
			name:       "internal error",
			err:        errors.New("database unavailable"),
			statusCode: http.StatusInternalServerError,
			body:       `{"error":"internal_error"}`,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)

			handled := writeLoginError(context, testCase.err)

			if !handled {
				t.Fatal("writeLoginError returned false")
			}
			if recorder.Code != testCase.statusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, testCase.statusCode)
			}
			if got := recorder.Body.String(); got != testCase.body {
				t.Fatalf("body = %s, want %s", got, testCase.body)
			}
		})
	}
}

func TestLoginHandlerReturnsInvalidRequestForMalformedJSON(t *testing.T) {
	// 测试目标：验证无法解析的登录 JSON 也遵循 invalid_request 公开错误码契约。
	// 构造方法：创建默认路由并向登录地址发送语法错误的 JSON 请求体。
	// 输入数据：Content-Type 为 application/json，正文为 {invalid-json。
	// 预期行为：响应状态为 400，正文为 {"error":"invalid_request"}。
	gin.SetMode(gin.TestMode)
	router := NewRouter(nil)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader("{invalid-json"))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if got := recorder.Body.String(); got != `{"error":"invalid_request"}` {
		t.Fatalf("body = %s, want invalid_request", got)
	}
}
