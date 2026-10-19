package chat

import (
	"errors"
	"reflect"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func setupMessageReplyRepositories(t *testing.T, messages []entity.Message) {
	t.Helper()
	oldConversation, oldMember, oldList, oldCursors, oldTargets := findConversationByID, isActiveConversationMember, listMessages, findConversationCursors, findMessagesByIDs
	t.Cleanup(func() {
		findConversationByID, isActiveConversationMember, listMessages, findConversationCursors, findMessagesByIDs = oldConversation, oldMember, oldList, oldCursors, oldTargets
	})
	findConversationByID = func(uint64) (entity.Conversation, bool, error) {
		return entity.Conversation{ID: 42, ConversationType: "direct"}, true, nil
	}
	isActiveConversationMember = func(uint64, uint64) (bool, error) { return true, nil }
	listMessages = func(uint64, *uint64, *uint64, int) ([]entity.Message, bool, error) { return messages, false, nil }
	findConversationCursors = func(uint64, uint64) (entity.ConversationMemberCursor, entity.ConversationMemberCursor, error) {
		return entity.ConversationMemberCursor{}, entity.ConversationMemberCursor{}, nil
	}
}

func TestHistoryBatchesDistinctReplyTargetsOutsideCurrentPage(t *testing.T) {
	// 测试目标：验证历史页对重复、页外和缺失回复目标只作一次同会话批量查询。
	// 构造方法：返回三条回复，替换目标 repository 并返回一条页外 rich 目标及一条异常跨会话记录。
	// 输入数据：会话 42 的引用 ID 为 original、original、missing，目标正文为图文 blocks。
	// 预期行为：查询去重 ID 且带会话 42，页保留全部引用 ID，只暴露同会话 original 的原正文。
	original, missing := "original", "missing"
	setupMessageReplyRepositories(t, []entity.Message{{ReplyToMessageID: &original}, {ReplyToMessageID: &original}, {ReplyToMessageID: &missing}})
	calls := 0
	findMessagesByIDs = func(conversationID uint64, ids []string) ([]entity.Message, error) {
		calls++
		if conversationID != 42 || !reflect.DeepEqual(ids, []string{original, missing}) {
			t.Fatalf("lookup = %d, %v; want 42, [original missing]", conversationID, ids)
		}
		return []entity.Message{
			{MessageID: original, ConversationID: 42, SenderUserID: 2, MessageType: "rich", Content: entity.JSONValue(`{"blocks":[{"type":"text","text":"原文"},{"type":"image","attachment_id":"image"}]}`)},
			{MessageID: missing, ConversationID: 43, Content: entity.JSONValue(`{"text":"private"}`)},
		}, nil
	}
	page, err := ListConversationMessages(1, 42, nil, nil, 50)
	if err != nil || calls != 1 || len(page.ReplyTargets) != 1 || page.ReplyTargets[original].MessageType != "rich" || *page.Messages[2].ReplyToMessageID != missing {
		t.Fatalf("page=%#v, calls=%d, error=%v", page, calls, err)
	}
}

func TestHistoryWithoutRepliesDoesNotQueryTargets(t *testing.T) {
	// 测试目标：验证普通消息历史没有额外回复查询。
	// 构造方法：返回无引用消息，将目标 repository 替换成调用即失败的替身。
	// 输入数据：会话 42 一条普通消息。
	// 预期行为：历史页成功，回复目标集合为空且不调用额外查询。
	setupMessageReplyRepositories(t, []entity.Message{{MessageID: "plain"}})
	findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) { t.Fatal("unexpected reply lookup"); return nil, nil }
	page, err := ListConversationMessages(1, 42, nil, nil, 50)
	if err != nil || len(page.ReplyTargets) != 0 {
		t.Fatalf("page=%#v, error=%v", page, err)
	}
}

func TestHistoryChecksMembershipBeforeReplyLookup(t *testing.T) {
	// 测试目标：验证非成员不能读取回复目标。
	// 构造方法：设置现有会话但拒绝成员身份，目标 repository 调用即失败。
	// 输入数据：用户 1 请求无权限会话 42。
	// 预期行为：返回 ErrNotConversationMember，目标正文完全不查询。
	setupMessageReplyRepositories(t, nil)
	isActiveConversationMember = func(uint64, uint64) (bool, error) { return false, nil }
	findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) {
		t.Fatal("unauthorized reply lookup")
		return nil, nil
	}
	if _, err := ListConversationMessages(1, 42, nil, nil, 50); !errors.Is(err, ErrNotConversationMember) {
		t.Fatalf("error=%v", err)
	}
}

func TestHistoryPropagatesReplyLookupFailure(t *testing.T) {
	// 测试目标：验证目标查询出错不伪装成目标不存在。
	// 构造方法：返回一条回复消息，并令目标 repository 返回固定错误。
	// 输入数据：会话 42 回复 original，目标查询失败。
	// 预期行为：保留 errors.Is 错误身份，由 HTTP 既有边界映射通用错误。
	id := "original"
	setupMessageReplyRepositories(t, []entity.Message{{ReplyToMessageID: &id}})
	want := errors.New("lookup unavailable")
	findMessagesByIDs = func(uint64, []string) ([]entity.Message, error) { return nil, want }
	if _, err := ListConversationMessages(1, 42, nil, nil, 50); !errors.Is(err, want) {
		t.Fatalf("error=%v", err)
	}
}
