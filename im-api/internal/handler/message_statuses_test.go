package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	chatservice "github.com/0Whisperos/whisper/im-server/internal/service/chat"
	"github.com/gin-gonic/gin"
)

func messageStatusRequest(body, conversationID string, authenticated bool) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	if authenticated {
		engine.Use(func(context *gin.Context) { context.Set("authenticated_user_id", uint64(1)) })
	}
	engine.POST("/conversations/:conversation_id/messages/statuses", ConversationMessageStatuses)
	request := httptest.NewRequest(http.MethodPost, "/conversations/"+conversationID+"/messages/statuses", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestMessageStatusesHandlerReturnsNullableProtocolStates(t *testing.T) {
	// 测试目标：验证状态接口只输出ID和显式nullable撤回时间，并传递认证身份与输入。
	// 构造方法：替换状态服务，发起已认证的JSON请求，返回一条正常和一条已撤回状态。
	// 输入数据：用户1、会话42、两个UUID；撤回时间带+08:00和微秒。
	// 预期行为：HTTP200，撤回时间保留微秒和时区，未撤回为null，不包含正文。
	previous := listConversationMessageStatuses
	t.Cleanup(func() { listConversationMessageStatuses = previous })
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"}
	recalledAt := time.Date(2026, time.October, 23, 10, 11, 12, 123456000, time.FixedZone("CST", 8*60*60))
	listConversationMessageStatuses = func(userID, conversationID uint64, requested []string) ([]chatservice.MessageStatus, error) {
		if userID != 1 || conversationID != 42 || !reflect.DeepEqual(requested, ids) {
			t.Fatalf("request=%d,%d,%v", userID, conversationID, requested)
		}
		return []chatservice.MessageStatus{{MessageID: ids[0]}, {MessageID: ids[1], RecalledAt: &recalledAt}}, nil
	}
	recorder := messageStatusRequest(`{"message_ids":["`+ids[0]+`","`+ids[1]+`"]}`, "42", true)
	want := `{"statuses":[{"message_id":"` + ids[0] + `","recalled_at":null},{"message_id":"` + ids[1] + `","recalled_at":"2026-10-23T10:11:12.123456+08:00"}]}`
	if recorder.Code != http.StatusOK || recorder.Body.String() != want {
		t.Fatalf("status=%d, body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMessageStatusesHandlerKeepsEmptyStatusesAsArray(t *testing.T) {
	// 测试目标：验证没有找到ID时JSON结果为数组而非null。
	// 构造方法：替换服务返回nil状态切片，发送有效已认证请求。
	// 输入数据：会话42、一个UUID，服务结果nil且无错误。
	// 预期行为：HTTP200，正文恰为{"statuses":[]}。
	previous := listConversationMessageStatuses
	t.Cleanup(func() { listConversationMessageStatuses = previous })
	listConversationMessageStatuses = func(uint64, uint64, []string) ([]chatservice.MessageStatus, error) { return nil, nil }
	recorder := messageStatusRequest(`{"message_ids":["00000000-0000-4000-8000-000000000001"]}`, "42", true)
	if recorder.Code != http.StatusOK || recorder.Body.String() != `{"statuses":[]}` {
		t.Fatalf("status=%d, body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMessageStatusesHandlerRejectsMalformedRequestsWithoutService(t *testing.T) {
	// 测试目标：验证认证、会话路径与JSON解析失败时不调用状态服务。
	// 构造方法：服务替身调用即失败，逐项发送格式异常或未认证请求。
	// 输入数据：无认证、非数字/0会话、错误JSON、数组对象或message_ids元素类型错误。
	// 预期行为：未认证401，其余400 invalid_message_status_request。
	previous := listConversationMessageStatuses
	t.Cleanup(func() { listConversationMessageStatuses = previous })
	listConversationMessageStatuses = func(uint64, uint64, []string) ([]chatservice.MessageStatus, error) {
		t.Fatal("malformed request reached service")
		return nil, nil
	}
	testCases := []struct {
		name           string
		body           string
		conversationID string
		authenticated  bool
		status         int
	}{
		// 测试目标：拒绝匿名请求；构造方法：不注入用户；输入数据：会话42、{}；预期行为：401。
		{name: "unauthorized", body: `{}`, conversationID: "42", status: http.StatusUnauthorized},
		// 测试目标：拒绝非数字路径；构造方法：使用abc会话；输入数据：abc、{}；预期行为：400。
		{name: "non numeric conversation", body: `{}`, conversationID: "abc", authenticated: true, status: http.StatusBadRequest},
		// 测试目标：拒绝会话0；构造方法：使用零ID；输入数据：0、{}；预期行为：400。
		{name: "zero conversation", body: `{}`, conversationID: "0", authenticated: true, status: http.StatusBadRequest},
		// 测试目标：拒绝错误JSON；构造方法：发送未闭合对象；输入数据：{；预期行为：400。
		{name: "malformed JSON", body: `{`, conversationID: "42", authenticated: true, status: http.StatusBadRequest},
		// 测试目标：拒绝数组顶层；构造方法：发送JSON数组；输入数据：[]；预期行为：400。
		{name: "wrong object", body: `[]`, conversationID: "42", authenticated: true, status: http.StatusBadRequest},
		// 测试目标：拒绝错误元素类型；构造方法：message_ids内放数字；输入数据：{"message_ids":[1]}；预期行为：400。
		{name: "wrong ID type", body: `{"message_ids":[1]}`, conversationID: "42", authenticated: true, status: http.StatusBadRequest},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := messageStatusRequest(testCase.body, testCase.conversationID, testCase.authenticated)
			if recorder.Code != testCase.status {
				t.Fatalf("status=%d, body=%s", recorder.Code, recorder.Body.String())
			}
			if testCase.status == http.StatusBadRequest && !strings.Contains(recorder.Body.String(), `"error_code":"invalid_message_status_request"`) {
				t.Fatalf("body=%s", recorder.Body.String())
			}
		})
	}
}

func TestMessageStatusesHandlerUsesStableServiceErrorMappings(t *testing.T) {
	// 测试目标：验证状态服务错误沿用会话/成员契约，并隐藏未知内部错误。
	// 构造方法：逐项让服务返回输入、会话、成员或内部错误，发送已认证请求。
	// 输入数据：四个公开错误场景及secret database unavailable内部消息。
	// 预期行为：返回400/404/403/500及稳定error_code，内部错误细节不出现在响应中。
	previous := listConversationMessageStatuses
	t.Cleanup(func() { listConversationMessageStatuses = previous })
	testCases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		// 测试目标：映射输入错误；构造方法：服务返回输入sentinel；输入数据：ErrInvalidMessageStatusRequest；预期行为：400/invalid_message_status_request。
		{name: "invalid request", err: chatservice.ErrInvalidMessageStatusRequest, status: http.StatusBadRequest, code: "invalid_message_status_request"},
		// 测试目标：映射缺失会话；构造方法：服务返回会话sentinel；输入数据：ErrConversationNotFound；预期行为：404/conversation_not_found。
		{name: "missing conversation", err: chatservice.ErrConversationNotFound, status: http.StatusNotFound, code: "conversation_not_found"},
		// 测试目标：映射成员错误；构造方法：服务返回成员sentinel；输入数据：ErrNotConversationMember；预期行为：403/not_conversation_member。
		{name: "not member", err: chatservice.ErrNotConversationMember, status: http.StatusForbidden, code: "not_conversation_member"},
		// 测试目标：隐藏内部错误；构造方法：服务返回普通错误；输入数据：secret database unavailable；预期行为：500/internal_error且不泄露原消息。
		{name: "internal failure", err: errors.New("secret database unavailable"), status: http.StatusInternalServerError, code: "internal_error"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			listConversationMessageStatuses = func(uint64, uint64, []string) ([]chatservice.MessageStatus, error) { return nil, testCase.err }
			recorder := messageStatusRequest(`{"message_ids":[]}`, "42", true)
			if recorder.Code != testCase.status || !strings.Contains(recorder.Body.String(), `"error_code":"`+testCase.code+`"`) || strings.Contains(recorder.Body.String(), "secret database") {
				t.Fatalf("status=%d, body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
