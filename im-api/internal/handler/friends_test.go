package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/router"
)

func TestFriendRoutesRequireAccessToken(t *testing.T) {
	// 测试目标：验证账号搜索和好友申请的 HTTP 路由都受 access-token middleware 保护。
	// 构造方法：创建正式 router 并对每个好友相关路由发送不带 Authorization 的请求。
	// 输入数据：五个新路由的 GET/POST 方法与空认证头。
	// 预期行为：每个路由均返回 401，且认证失败时不会进入业务 handler。
	engine := router.New(nil)
	testCases := []struct{ method, path string }{
		{http.MethodGet, "/v1/users/by-account/00100002"},
		{http.MethodGet, "/v1/friend-requests?direction=incoming"},
		{http.MethodPost, "/v1/friend-requests"},
		{http.MethodPost, "/v1/friend-requests/42/accept"},
		{http.MethodPost, "/v1/friend-requests/42/reject"},
	}
	for _, testCase := range testCases {
		// 测试目标：验证当前 HTTP 方法和路径未经认证时被拒绝。
		// 构造方法：使用 httptest 创建空请求并交给路由引擎处理。
		// 输入数据：请求路径为子测试指定 endpoint，Authorization header 缺失。
		// 预期行为：响应状态码为 401 Unauthorized。
		t.Run(testCase.method+" "+testCase.path, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, nil)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusUnauthorized, response.Body.String())
			}
		})
	}
}
