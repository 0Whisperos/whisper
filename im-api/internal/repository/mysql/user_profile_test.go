//go:build cgo

package mysql

import (
	"context"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestUpdateUserProfileReturnsLockedPreviousAvatarAndUpdatedUser(t *testing.T) {
	// 测试目标：验证资料事务同时返回锁定时读取到的旧头像和提交后的完整用户资料。
	// 构造方法：使用临时 SQLite 正式表，先给用户 1 写入旧 key，再调用 UpdateUserProfile 替换全部资料字段。
	// 输入数据：nickname=张三、signature=hello、新旧两个不同 png key。
	// 预期行为：返回资料包含新 key，oldAvatar 是旧 key，数据库最终值与返回资料一致。
	setupFriendRequestDB(t)
	oldKey := "avatars/1/ffeeddccbbaa99887766554433221100.png"
	newKey := "avatars/1/00112233445566778899aabbccddeeff.png"
	if err := global.MysqlDB.Model(&entity.User{}).Where("id = ?", 1).Update("avatar_object_key", oldKey).Error; err != nil {
		t.Fatalf("set old avatar: %v", err)
	}

	updated, previous, found, err := UpdateUserProfile(context.Background(), 1, UserProfileUpdate{
		Nickname:        "张三",
		Signature:       "hello",
		UpdateAvatar:    true,
		AvatarObjectKey: &newKey,
	})
	if err != nil {
		t.Fatalf("UpdateUserProfile returned an error: %v", err)
	}
	if !found || previous == nil || *previous != oldKey {
		t.Fatalf("found/previous = %v/%v, want true/%q", found, previous, oldKey)
	}
	if updated.Nickname != "张三" || updated.Signature != "hello" || updated.AvatarObjectKey == nil || *updated.AvatarObjectKey != newKey {
		t.Fatalf("updated = %#v, want new profile", updated)
	}

	var saved entity.User
	if err := global.MysqlDB.First(&saved, 1).Error; err != nil {
		t.Fatalf("reload saved user: %v", err)
	}
	if saved.AvatarObjectKey == nil || *saved.AvatarObjectKey != newKey {
		t.Fatalf("saved = %#v, want new avatar key", saved)
	}
}

func TestUpdateUserProfileCanClearAvatarWithoutChangingSchema(t *testing.T) {
	// 测试目标：验证显式 null 对应的更新能把 avatar_object_key 写为数据库 NULL。
	// 构造方法：使用临时 SQLite 正式表，先设置旧 key，再以 UpdateAvatar=true、AvatarObjectKey=nil 更新。
	// 输入数据：用户 1、nickname=张三、signature 为空、nil 头像 key。
	// 预期行为：返回 previous 为旧 key，更新后的实体和数据库字段都为 nil。
	setupFriendRequestDB(t)
	oldKey := "avatars/1/ffeeddccbbaa99887766554433221100.png"
	if err := global.MysqlDB.Model(&entity.User{}).Where("id = ?", 1).Update("avatar_object_key", oldKey).Error; err != nil {
		t.Fatalf("set old avatar: %v", err)
	}

	updated, previous, found, err := UpdateUserProfile(context.Background(), 1, UserProfileUpdate{
		Nickname:     "张三",
		UpdateAvatar: true,
	})
	if err != nil {
		t.Fatalf("UpdateUserProfile returned an error: %v", err)
	}
	if !found || previous == nil || *previous != oldKey || updated.AvatarObjectKey != nil {
		t.Fatalf("found/previous/updated = %v/%v/%#v, want cleared avatar", found, previous, updated)
	}
}
