//go:build cgo

package mysql

import (
	"bytes"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestListMessagesIncludesRichMessagesAcrossPagination(t *testing.T) {
	// 测试目标：验证历史查询保留 rich 消息，并在普通历史、向前和向后分页中维持序号与会话隔离。
	// 构造方法：复用临时 SQLite 正式表，在会话 42 写入 text/rich/text 三条消息，并在会话 43 写入一条 rich 消息。
	// 输入数据：会话 42 的 seq=1 text、seq=2 rich、seq=3 text；会话 43 的 seq=1 rich；rich content 含图片 attachment_id。
	// 预期行为：会话 42 最新两条为 seq=2/3 且 hasMore=true，旧页含 seq=1，fromSeq=2 返回 seq=2/3，rich content 字节不变且不混入会话 43。
	setupFriendRequestDB(t)

	richContent := entity.JSONValue(`{"blocks":[{"type":"text","text":"图片前"},{"type":"image","attachment_id":"6b916932-0738-48f2-b62e-f3f212472d73"}]}`)
	createdAt := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	messages := []entity.Message{
		{MessageID: "00000000-0000-4000-8000-000000000001", ConversationID: 42, ConversationSeq: 1, SenderUserID: 1, ClientMessageID: "10000000-0000-4000-8000-000000000001", MessageType: "text", Content: entity.JSONValue(`{"text":"之前"}`), ContentHash: "hash-1", CreatedAt: createdAt},
		{MessageID: "00000000-0000-4000-8000-000000000002", ConversationID: 42, ConversationSeq: 2, SenderUserID: 2, ClientMessageID: "10000000-0000-4000-8000-000000000002", MessageType: "rich", Content: richContent, ContentHash: "hash-2", CreatedAt: createdAt.Add(time.Minute)},
		{MessageID: "00000000-0000-4000-8000-000000000003", ConversationID: 42, ConversationSeq: 3, SenderUserID: 1, ClientMessageID: "10000000-0000-4000-8000-000000000003", MessageType: "text", Content: entity.JSONValue(`{"text":"之后"}`), ContentHash: "hash-3", CreatedAt: createdAt.Add(2 * time.Minute)},
		{MessageID: "00000000-0000-4000-8000-000000000004", ConversationID: 43, ConversationSeq: 1, SenderUserID: 1, ClientMessageID: "10000000-0000-4000-8000-000000000004", MessageType: "rich", Content: richContent, ContentHash: "hash-4", CreatedAt: createdAt},
	}
	for _, message := range messages {
		if err := global.MysqlDB.Create(&message).Error; err != nil {
			t.Fatalf("create message seq %d in conversation %d: %v", message.ConversationSeq, message.ConversationID, err)
		}
	}

	latest, hasMore, err := ListMessages(42, nil, nil, 2)
	if err != nil {
		t.Fatalf("ListMessages latest page returned an error: %v", err)
	}
	if !hasMore || len(latest) != 2 || latest[0].ConversationSeq != 2 || latest[1].ConversationSeq != 3 {
		t.Fatalf("latest page = seqs %v, hasMore=%v; want seqs [2 3], hasMore=true", messageSequences(latest), hasMore)
	}
	if latest[0].MessageType != "rich" || !bytes.Equal(latest[0].Content, richContent) {
		t.Fatalf("rich message = type %q, content %s; want original rich content %s", latest[0].MessageType, latest[0].Content, richContent)
	}

	beforeSeq := uint64(2)
	older, hasMore, err := ListMessages(42, &beforeSeq, nil, 2)
	if err != nil {
		t.Fatalf("ListMessages older page returned an error: %v", err)
	}
	if hasMore || len(older) != 1 || older[0].ConversationSeq != 1 {
		t.Fatalf("older page = seqs %v, hasMore=%v; want seqs [1], hasMore=false", messageSequences(older), hasMore)
	}

	fromSeq := uint64(2)
	forward, hasMore, err := ListMessages(42, nil, &fromSeq, 2)
	if err != nil {
		t.Fatalf("ListMessages forward page returned an error: %v", err)
	}
	if hasMore || len(forward) != 2 || forward[0].ConversationSeq != 2 || forward[1].ConversationSeq != 3 {
		t.Fatalf("forward page = seqs %v, hasMore=%v; want seqs [2 3], hasMore=false", messageSequences(forward), hasMore)
	}
}

func messageSequences(messages []entity.Message) []uint64 {
	sequences := make([]uint64, 0, len(messages))
	for _, message := range messages {
		sequences = append(sequences, message.ConversationSeq)
	}
	return sequences
}
