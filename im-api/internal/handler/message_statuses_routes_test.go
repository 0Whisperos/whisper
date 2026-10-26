package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/router"
)

func TestMessageStatusesRouteRequiresAccessToken(t *testing.T) {
	// 测试目标：验证正式注册的批查路由受access-token中间件保护。
	// 构造方法：创建正式router，向statuses接口发送不带Authorization的POST。
	// 输入数据：POST /v1/conversations/42/messages/statuses。
	// 预期行为：返回401，未进入状态查询服务。
	engine := router.New(nil)
	request := httptest.NewRequest(http.MethodPost, "/v1/conversations/42/messages/statuses", nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, body=%s", recorder.Code, recorder.Body.String())
	}
}
