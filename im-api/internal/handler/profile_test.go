package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/router"
)

func TestProfileRoutesRequireAccessToken(t *testing.T) {
	// 测试目标：验证头像上传授权、下载授权和资料更新接口都受 access-token 中间件保护。
	// 构造方法：创建正式路由，分别向三个接口发送不带 Authorization 的请求。
	// 输入数据：两个 POST 路径和一个 PUT 路径。
	// 预期行为：每个请求均返回 401，且不会进入对象存储或资料服务。
	engine := router.New(nil)
	testCases := []struct {
		method string
		path   string
	}{
		// 测试目标：验证上传授权接口要求登录。
		// 构造方法：向正式路由发送无认证 POST。
		// 输入数据：POST /v1/me/avatar-upload-authorization。
		// 预期行为：返回 401 Unauthorized。
		{method: http.MethodPost, path: "/v1/me/avatar-upload-authorization"},
		// 测试目标：验证下载授权接口要求登录。
		// 构造方法：向正式路由发送无认证 POST。
		// 输入数据：POST /v1/me/avatar-download-authorization。
		// 预期行为：返回 401 Unauthorized。
		{method: http.MethodPost, path: "/v1/me/avatar-download-authorization"},
		// 测试目标：验证资料更新接口要求登录。
		// 构造方法：向正式路由发送无认证 PUT。
		// 输入数据：PUT /v1/me/profile。
		// 预期行为：返回 401 Unauthorized。
		{method: http.MethodPut, path: "/v1/me/profile"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.method+" "+testCase.path, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, nil)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
			}
		})
	}
}
