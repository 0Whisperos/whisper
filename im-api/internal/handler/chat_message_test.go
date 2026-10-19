package handler

import (
	"encoding/json"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestMessageResponseIncludesShallowReplyAndOriginalContent(t *testing.T) {
	// 测试目标：验证历史 wire 回复对象仅含目标身份、类型和原正文，不递归包含引用。
	// 构造方法：映射一条回复及其带有上层引用的 rich 目标，编码 JSON 后检查字段。
	// 输入数据：reply 引用 original，original 再引用 older，正文为中文和图片 blocks。
	// 预期行为：保留 reply_to_message_id，reply_to 仅四个字段且原正文完整。
	id, older := "original", "older"
	content := entity.JSONValue(`{"blocks":[{"type":"text","text":"原文"},{"type":"image","attachment_id":"image"}]}`)
	result := messageResponse(entity.Message{ConversationID: 42, ReplyToMessageID: &id}, map[string]entity.Message{
		id: {MessageID: id, ConversationID: 42, SenderUserID: 2, MessageType: "rich", Content: content, ReplyToMessageID: &older},
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
	if string(wire["reply_to_message_id"]) != `"original"` || len(target) != 4 || string(target["content"]) != string(content) {
		t.Fatalf("wire=%s", body)
	}
}

func TestMessageResponseKeepsMissingReplyIDWithNullTarget(t *testing.T) {
	// 测试目标：验证缺失回复目标仍保留关系 ID，普通消息显式返回 null。
	// 构造方法：分别映射无引用及目标未找到的消息，检查编码结果。
	// 输入数据：空目标集合，消息分别无引用和引用 missing。
	// 预期行为：两者 reply_to 均 null，reply_to_message_id 分别为 null 和 missing。
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
		if string(wire["reply_to"]) != "null" || string(wire["reply_to_message_id"]) != wantID {
			t.Fatalf("wire=%s", body)
		}
	}
}
