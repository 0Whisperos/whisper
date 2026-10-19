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

func TestFindMessagesByIDsScopesReplyTargetsToConversation(t *testing.T) {
	// 测试目标：验证批量目标查询读取页外 text/rich 原文但不泄露其他会话或不存在的消息。
	// 构造方法：迁移临时 SQLite，插入会话 42 两条目标和会话 43 一条目标，再批量查询。
	// 输入数据：会话 42 的 first/second、会话 43 的 private，以及 missing ID。
	// 预期行为：只返回会话 42 两条消息，正文与数据库一致，空 ID 数组返回空结果。
	setupFriendRequestDB(t)
	for index, message := range []entity.Message{
		{MessageID: "first", ConversationID: 42, ConversationSeq: 1, SenderUserID: 1, ClientMessageID: "client-1", MessageType: "text", Content: entity.JSONValue(`{"text":"原文"}`), ContentHash: "hash"},
		{MessageID: "second", ConversationID: 42, ConversationSeq: 2, SenderUserID: 1, ClientMessageID: "client-2", MessageType: "rich", Content: entity.JSONValue(`{"blocks":[{"type":"image","attachment_id":"image"}]}`), ContentHash: "hash"},
		{MessageID: "private", ConversationID: 43, ConversationSeq: 1, SenderUserID: 2, ClientMessageID: "client-3", MessageType: "text", Content: entity.JSONValue(`{"text":"secret"}`), ContentHash: "hash"},
	} {
		if err := global.MysqlDB.Create(&message).Error; err != nil {
			t.Fatalf("insert %d: %v", index, err)
		}
	}
	messages, err := FindMessagesByIDs(42, []string{"first", "second", "private", "missing", "first"})
	if err != nil || len(messages) != 2 {
		t.Fatalf("messages=%#v, error=%v", messages, err)
	}
	for _, message := range messages {
		if message.ConversationID != 42 || len(message.Content) == 0 {
			t.Fatalf("unexpected target %#v", message)
		}
	}
	if messages, err := FindMessagesByIDs(42, nil); err != nil || len(messages) != 0 {
		t.Fatalf("empty lookup=%#v, error=%v", messages, err)
	}
}

func TestMessageMigrationAddsNullableReplyWithoutChangingLegacyRows(t *testing.T) {
	// 测试目标：验证 AutoMigrate 为旧 messages 表添加可空回复列，并保留现有消息正文。
	// 构造方法：在临时 SQLite 移除回复列模拟旧 schema，插入旧消息后重新迁移 Message。
	// 输入数据：无 reply_to_message_id 的 legacy 消息，正文为 {"text":"old"}。
	// 预期行为：新增列存在，旧消息可读且引用为空，随后可持久化非空引用并读回。
	setupFriendRequestDB(t)
	if err := global.MysqlDB.Migrator().DropColumn(&entity.Message{}, "reply_to_message_id"); err != nil {
		t.Fatal(err)
	}
	if err := global.MysqlDB.Exec(`INSERT INTO messages (message_id, conversation_id, conversation_seq, sender_user_id, client_message_id, message_type, content, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, "legacy", 42, 1, 1, "legacy-client", "text", `{"text":"old"}`, "hash", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	if err := global.MysqlDB.AutoMigrate(&entity.Message{}); err != nil {
		t.Fatal(err)
	}
	if !global.MysqlDB.Migrator().HasColumn(&entity.Message{}, "reply_to_message_id") {
		t.Fatal("missing reply column")
	}
	var legacy entity.Message
	if err := global.MysqlDB.Where("message_id = ?", "legacy").First(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.ReplyToMessageID != nil || string(legacy.Content) != `{"text":"old"}` {
		t.Fatalf("legacy=%#v", legacy)
	}
	if err := global.MysqlDB.Model(&legacy).Update("reply_to_message_id", "target").Error; err != nil {
		t.Fatal(err)
	}
	messages, _, err := ListMessages(42, nil, nil, 50)
	if err != nil || len(messages) != 1 || messages[0].ReplyToMessageID == nil || *messages[0].ReplyToMessageID != "target" {
		t.Fatalf("messages=%#v, error=%v", messages, err)
	}
}
