package handler

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestMessageResponseIncludesShallowReplyAndOriginalContent(t *testing.T) {
	// 测试目标：验证已撤回消息及浅层引用暴露撤回状态并完整保留原正文，不递归包含引用。
	// 构造方法：映射一条回复及其带有上层引用的 rich 目标，编码 JSON 后检查字段。
	// 输入数据：已撤回 reply 引用已撤回 original，original 再引用 older，正文为中文和图片 blocks。
	// 预期行为：保留 reply_to_message_id，reply_to 仅五个字段，两份正文完整且撤回时间保留微秒和时区。
	id, older := "original", "older"
	recalledAt := time.Date(2026, time.October, 23, 10, 11, 12, 123456000, time.FixedZone("CST", 8*60*60))
	content := entity.JSONValue(`{"blocks":[{"type":"text","text":"原文"},{"type":"image","attachment_id":"image"}]}`)
	result := messageResponse(entity.Message{ConversationID: 42, MessageType: "rich", Content: content, ReplyToMessageID: &id, RecalledAt: &recalledAt}, map[string]entity.Message{
		id: {MessageID: id, ConversationID: 42, SenderUserID: 2, MessageType: "rich", Content: content, ReplyToMessageID: &older, RecalledAt: &recalledAt},
	})
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatal(err)
	}
	var target map[string]json.RawMessage
	if err := json.Unmarshal(wire["reply_to"], &target); err != nil {
		t.Fatal(err)
	}
	if string(wire["reply_to_message_id"]) != `"original"` || len(target) != 5 || string(target["content"]) != string(content) || string(wire["content"]) != string(content) || string(wire["message_type"]) != `"rich"` {
		t.Fatalf("wire=%s", body)
	}
	if string(wire["recalled_at"]) != `"2026-10-23T10:11:12.123456+08:00"` || string(target["recalled_at"]) != string(wire["recalled_at"]) {
		t.Fatalf("wire=%s", body)
	}
}

func TestMessageResponseKeepsMissingReplyIDWithNullTarget(t *testing.T) {
	// 测试目标：验证缺失回复目标仍保留关系 ID，普通消息显式返回 null。
	// 构造方法：分别映射无引用及目标未找到的消息，检查编码结果。
	// 输入数据：空目标集合，消息分别无引用和引用 missing。
	// 预期行为：两者 reply_to 和 recalled_at 均为显式 null，reply_to_message_id 分别为 null 和 missing。
	id := "missing"
	for _, message := range []entity.Message{
		// 测试目标：普通消息输出显式 null；构造方法：映射空引用消息；输入数据：nil 引用；预期行为：两个引用字段均 null。
		{},
		// 测试目标：缺失目标保留引用 ID；构造方法：映射目标未加载消息；输入数据：missing ID；预期行为：引用 ID 保留、目标对象 null。
		{ReplyToMessageID: &id},
	} {
		body, err := json.Marshal(messageResponse(message, nil))
		if err != nil {
			t.Fatal(err)
		}
		var wire map[string]json.RawMessage
		if err := json.Unmarshal(body, &wire); err != nil {
			t.Fatal(err)
		}
		wantID := "null"
		if message.ReplyToMessageID != nil {
			wantID = `"missing"`
		}
		if string(wire["reply_to"]) != "null" || string(wire["reply_to_message_id"]) != wantID || string(wire["recalled_at"]) != "null" {
			t.Fatalf("wire=%s", body)
		}
	}
}

func TestMessageResponseKeepsUnrecalledReplyStateExplicitlyNull(t *testing.T) {
	// 测试目标：验证未撤回的浅层引用也显式输出 recalled_at:null。
	// 构造方法：映射一条引用正常 text 消息的回复，并编码 JSON。
	// 输入数据：reply 引用 original，目标正文 {"text":"原文"}，RecalledAt=nil。
	// 预期行为：引用的 message_type/content 保留且 recalled_at 字段存在并为 null。
	id := "original"
	result := messageResponse(entity.Message{ConversationID: 42, ReplyToMessageID: &id}, map[string]entity.Message{
		id: {MessageID: id, ConversationID: 42, MessageType: "text", Content: entity.JSONValue(`{"text":"原文"}`)},
	})
	body, err := json.Marshal(result.ReplyTo)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatal(err)
	}
	if string(wire["recalled_at"]) != "null" || string(wire["content"]) != `{"text":"原文"}` || string(wire["message_type"]) != `"text"` {
		t.Fatalf("wire=%s", body)
	}
}
