package chat

import (
	"errors"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestMessageStatusesAuthorizeBeforeLoadingMessages(t *testing.T) {
	// 测试目标：验证只有存在的 direct 会话 active 成员能批查消息状态。
	// 构造方法：逐项替换会话与成员查询，让消息批查调用即失败。
	// 输入数据：会话不存在、group 会话、非成员、会话查询失败和成员查询失败。
	// 预期行为：返回对应错误、保留底层错误身份，失败时不会查询消息。
	lookupFailure := errors.New("lookup failed")
	testCases := []struct {
		name            string
		conversation    entity.Conversation
		found           bool
		conversationErr error
		member          bool
		memberErr       error
		want            error
	}{
		// 测试目标：拒绝缺失会话；构造方法：查询返回未找到；输入数据：会话42不存在；预期行为：ErrConversationNotFound。
		{name: "missing conversation", want: ErrConversationNotFound},
		// 测试目标：拒绝非direct会话；构造方法：返回group会话；输入数据：42/group；预期行为：ErrConversationNotFound。
		{name: "non direct", conversation: entity.Conversation{ID: 42, ConversationType: "group"}, found: true, want: ErrConversationNotFound},
		// 测试目标：拒绝非active成员；构造方法：存在direct会话但成员查询false；输入数据：用户1、会话42；预期行为：ErrNotConversationMember。
		{name: "not active member", conversation: entity.Conversation{ID: 42, ConversationType: "direct"}, found: true, want: ErrNotConversationMember},
		// 测试目标：保留会话查询错误；构造方法：查询返回固定错误；输入数据：lookupFailure；预期行为：errors.Is仍匹配。
		{name: "conversation query fails", conversationErr: lookupFailure, want: lookupFailure},
		// 测试目标：保留成员查询错误；构造方法：direct会话存在而成员查询失败；输入数据：lookupFailure；预期行为：errors.Is仍匹配。
		{name: "membership query fails", conversation: entity.Conversation{ID: 42, ConversationType: "direct"}, found: true, memberErr: lookupFailure, want: lookupFailure},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			setupMessageReplyRepositories(t, nil)
			findConversationByID = func(uint64) (entity.Conversation, bool, error) {
				return testCase.conversation, testCase.found, testCase.conversationErr
			}
			isActiveConversationMember = func(uint64, uint64) (bool, error) {
				if !testCase.found || testCase.conversation.ConversationType != "direct" {
					t.Fatal("membership queried before direct conversation exists")
				}
				return testCase.member, testCase.memberErr
			}
			findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) {
				t.Fatal("message query ran without authorization")
				return nil, nil
			}
			if _, err := ListConversationMessageStatuses(1, 42, []string{firstStatusID}); !errors.Is(err, testCase.want) {
				t.Fatalf("error=%v, want=%v", err, testCase.want)
			}
		})
	}
}

func TestMessageStatusesPreserveMessageLookupErrorIdentity(t *testing.T) {
	// 测试目标：验证批查失败不伪装成无结果并保留底层错误身份。
	// 构造方法：授权direct会话后让消息查询返回固定错误。
	// 输入数据：用户1、会话42、first UUID、lookupFailure。
	// 预期行为：结果为nil，errors.Is仍匹配lookupFailure。
	setupMessageReplyRepositories(t, nil)
	want := errors.New("message lookup failed")
	findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) { return nil, want }
	statuses, err := ListConversationMessageStatuses(1, 42, []string{firstStatusID})
	if statuses != nil || !errors.Is(err, want) {
		t.Fatalf("statuses=%#v, error=%v", statuses, err)
	}
}
