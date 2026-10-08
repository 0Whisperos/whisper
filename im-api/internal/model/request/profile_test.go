package request

import (
	"encoding/json"
	"testing"
)

func TestUpdateProfileDistinguishesOmittedAvatarField(t *testing.T) {
	// 测试目标：验证资料请求能识别 avatar_object_key 被省略，避免误清除数据库头像。
	// 构造方法：反序列化只包含昵称和签名的 JSON。
	// 输入数据：{"nickname":"张三","signature":"hello"}。
	// 预期行为：AvatarObjectKey.Present=false 且 Value=nil。
	var payload UpdateProfile
	if err := json.Unmarshal([]byte(`{"nickname":"张三","signature":"hello"}`), &payload); err != nil {
		t.Fatalf("Unmarshal returned an error: %v", err)
	}
	if payload.AvatarObjectKey.Present || payload.AvatarObjectKey.Value != nil {
		t.Fatalf("AvatarObjectKey = %#v, want omitted state", payload.AvatarObjectKey)
	}
}

func TestUpdateProfileRecognizesNullAvatarField(t *testing.T) {
	// 测试目标：验证显式 null 会被识别为清除头像，而不是字段省略。
	// 构造方法：反序列化 avatar_object_key=null 的完整资料请求。
	// 输入数据：昵称张三、空签名和 null 头像 key。
	// 预期行为：AvatarObjectKey.Present=true 且 Value=nil。
	var payload UpdateProfile
	if err := json.Unmarshal([]byte(`{"nickname":"张三","signature":"","avatar_object_key":null}`), &payload); err != nil {
		t.Fatalf("Unmarshal returned an error: %v", err)
	}
	if !payload.AvatarObjectKey.Present || payload.AvatarObjectKey.Value != nil {
		t.Fatalf("AvatarObjectKey = %#v, want explicit null state", payload.AvatarObjectKey)
	}
}

func TestUpdateProfileRecognizesStringAvatarField(t *testing.T) {
	// 测试目标：验证字符串头像 key 会被识别为替换头像。
	// 构造方法：反序列化包含 avatar_object_key 字符串的完整资料请求。
	// 输入数据：avatar_object_key=avatars/7/00112233445566778899aabbccddeeff.png。
	// 预期行为：AvatarObjectKey.Present=true，Value 指向输入字符串。
	var payload UpdateProfile
	if err := json.Unmarshal([]byte(`{"nickname":"张三","signature":"","avatar_object_key":"avatars/7/00112233445566778899aabbccddeeff.png"}`), &payload); err != nil {
		t.Fatalf("Unmarshal returned an error: %v", err)
	}
	if !payload.AvatarObjectKey.Present || payload.AvatarObjectKey.Value == nil || *payload.AvatarObjectKey.Value != "avatars/7/00112233445566778899aabbccddeeff.png" {
		t.Fatalf("AvatarObjectKey = %#v, want replacement key", payload.AvatarObjectKey)
	}
}
