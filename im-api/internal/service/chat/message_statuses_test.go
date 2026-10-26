package chat

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

const firstStatusID = "abcdef01-0000-4000-8000-000000000001"
const secondStatusID = "abcdef02-0000-4000-8000-000000000002"
const privateStatusID = "abcdef03-0000-4000-8000-000000000003"
const missingStatusID = "abcdef04-0000-4000-8000-000000000004"

func TestMessageStatusesPreserveInputOrderAndConversationIsolation(t *testing.T) {
	// 测试目标：验证批查按首次输入顺序去重、保留撤回状态并排除跨会话和缺失目标。
	// 构造方法：授权用户 1 查询会话 42，目标查询返回乱序消息、跨会话记录及未请求记录。
	// 输入数据：second、first 大写/小写重复、private、missing；first 由用户 2 发送且已撤回。
	// 预期行为：查询只收到规范化去重 ID，返回 second(null)、first(撤回时间)，不要求请求人为发送者。
	setupMessageReplyRepositories(t, nil)
	recalledAt := time.Date(2026, time.October, 23, 10, 0, 0, 0, time.UTC)
	authorized := false
	isActiveConversationMember = func(conversationID, userID uint64) (bool, error) {
		if conversationID != 42 || userID != 1 {
			t.Fatalf("membership=%d,%d", conversationID, userID)
		}
		authorized = true
		return true, nil
	}
	findMessagesByIDs = func(conversationID uint64, ids []string) ([]entity.Message, error) {
		if !authorized || conversationID != 42 || !reflect.DeepEqual(ids, []string{secondStatusID, firstStatusID, privateStatusID, missingStatusID}) {
			t.Fatalf("query=%d,%v", conversationID, ids)
		}
		return []entity.Message{
			{MessageID: firstStatusID, ConversationID: 42, SenderUserID: 2, RecalledAt: &recalledAt},
			{MessageID: privateStatusID, ConversationID: 43, RecalledAt: &recalledAt},
			{MessageID: secondStatusID, ConversationID: 42, SenderUserID: 2},
			{MessageID: "unrequested", ConversationID: 42},
		}, nil
	}
	statuses, err := ListConversationMessageStatuses(1, 42, []string{secondStatusID, strings.ToUpper(firstStatusID), firstStatusID, privateStatusID, missingStatusID})
	if err != nil || len(statuses) != 2 || statuses[0].MessageID != secondStatusID || statuses[0].RecalledAt != nil || statuses[1].MessageID != firstStatusID || statuses[1].RecalledAt == nil || !statuses[1].RecalledAt.Equal(recalledAt) {
		t.Fatalf("statuses=%#v, error=%v", statuses, err)
	}
}

func TestMessageStatusesAcceptMaximumBatch(t *testing.T) {
	// 测试目标：验证 100 个合法 UUID 的上边界被接受且不会截断。
	// 构造方法：授权会话 42，批查替身逐项返回输入对应消息。
	// 输入数据：100 个不同 UUID，用户 1、会话 42。
	// 预期行为：查询与结果均有 100 项，顺序与输入一致。
	setupMessageReplyRepositories(t, nil)
	ids := make([]string, 100)
	for index := range ids {
		ids[index] = fmt.Sprintf("00000000-0000-4000-8000-%012d", index)
	}
	findMessagesByIDs = func(conversationID uint64, requested []string) ([]entity.Message, error) {
		if !reflect.DeepEqual(requested, ids) {
			t.Fatalf("requested IDs=%v", requested)
		}
		messages := make([]entity.Message, len(requested))
		for index, id := range requested {
			messages[index] = entity.Message{MessageID: id, ConversationID: conversationID}
		}
		return messages, nil
	}
	statuses, err := ListConversationMessageStatuses(1, 42, ids)
	if err != nil || len(statuses) != 100 {
		t.Fatalf("statuses=%#v, error=%v", statuses, err)
	}
	for index, status := range statuses {
		if status.MessageID != ids[index] {
			t.Fatalf("status %d=%#v", index, status)
		}
	}
}

func TestMessageStatusesRejectInvalidRawRequestsBeforeRepositoryAccess(t *testing.T) {
	// 测试目标：验证原始批次大小和 UUID 校验，不让去重绕过 100 项限制。
	// 构造方法：将会话查询替换成调用即失败的替身，对非法输入逐个调用服务。
	// 输入数据：空数组、101 个重复 ID、空 ID、非 UUID、错误连字符、非十六进制、带空格和会话 0。
	// 预期行为：全部返回 ErrInvalidMessageStatusRequest，且不查询数据库。
	setupMessageReplyRepositories(t, nil)
	findConversationByID = func(uint64) (entity.Conversation, bool, error) {
		t.Fatal("invalid request queried conversation")
		return entity.Conversation{}, false, nil
	}
	oversized := make([]string, 101)
	for index := range oversized {
		oversized[index] = firstStatusID
	}
	testCases := []struct {
		name           string
		conversationID uint64
		ids            []string
	}{
		// 测试目标：拒绝空批次；构造方法：传入 nil；输入数据：会话42、nil；预期行为：输入错误且不查询。
		{name: "empty", conversationID: 42},
		// 测试目标：限制去重前大小；构造方法：重复ID101次；输入数据：101个first；预期行为：输入错误。
		{name: "raw duplicate overflow", conversationID: 42, ids: oversized},
		// 测试目标：拒绝空ID；构造方法：传入一个空字符串；输入数据：[""]；预期行为：输入错误。
		{name: "empty ID", conversationID: 42, ids: []string{""}},
		// 测试目标：拒绝普通文本；构造方法：传入非UUID；输入数据：["message"]；预期行为：输入错误。
		{name: "text ID", conversationID: 42, ids: []string{"message"}},
		// 测试目标：校验连字符；构造方法：替换UUID第一个连字符；输入数据：abcdef01_0000-4000-8000-000000000001；预期行为：输入错误。
		{name: "separator", conversationID: 42, ids: []string{"abcdef01_0000-4000-8000-000000000001"}},
		// 测试目标：拒绝非十六进制；构造方法：将首位改为g；输入数据：gbcdef01-0000-4000-8000-000000000001；预期行为：输入错误。
		{name: "non hex", conversationID: 42, ids: []string{"gbcdef01-0000-4000-8000-000000000001"}},
		// 测试目标：拒绝隐式空白修复；构造方法：在UUID前加空格；输入数据：空格+first；预期行为：输入错误。
		{name: "whitespace", conversationID: 42, ids: []string{" " + firstStatusID}},
		// 测试目标：拒绝零会话；构造方法：使用有效UUID和会话0；输入数据：0、first；预期行为：输入错误。
		{name: "zero conversation", conversationID: 0, ids: []string{firstStatusID}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := ListConversationMessageStatuses(1, testCase.conversationID, testCase.ids); !errors.Is(err, ErrInvalidMessageStatusRequest) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestMessageStatusesReturnEmptyArrayForMissingTargets(t *testing.T) {
	// 测试目标：验证合法的单ID查询找不到目标时返回非nil空集合。
	// 构造方法：授权会话42，让ID批查返回空结果。
	// 输入数据：用户1、会话42、missing UUID。
	// 预期行为：结果为空数组所需的非nil切片，不返回错误。
	setupMessageReplyRepositories(t, nil)
	findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) { return nil, nil }
	statuses, err := ListConversationMessageStatuses(1, 42, []string{missingStatusID})
	if err != nil || statuses == nil || len(statuses) != 0 {
		t.Fatalf("statuses=%#v, error=%v", statuses, err)
	}
}
