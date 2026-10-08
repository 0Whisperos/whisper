package profile

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

func TestUpdateProfileRejectsInvalidTextBeforeRepositoryAccess(t *testing.T) {
	// 测试目标：验证昵称必填且最多 15 个 Unicode 字符、签名最多 80 个 Unicode 字符。
	// 构造方法：提交空昵称和 81 个汉字的签名，并把仓储 stub 设为调用即失败。
	// 输入数据：nickname 仅含空格，signature 为 81 个“签”字。
	// 预期行为：返回 ErrInvalidProfile，且不访问用户仓储或对象存储。
	store := &fakeStore{}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		t.Fatal("FindUserByID should not be called")
		return entity.User{}, false, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "   ", strings.Repeat("签", 81), false, nil)
	if !errors.Is(err, ErrInvalidProfile) {
		t.Fatalf("error = %v, want ErrInvalidProfile", err)
	}
}

func TestUpdateProfileWithoutAvatarSkipsObjectStorage(t *testing.T) {
	// 测试目标：验证仅修改昵称和签名时不会读取、上传或删除对象。
	// 构造方法：让用户仓储返回现有头像，并记录资料更新参数。
	// 输入数据：昵称带首尾空格、签名 hello、avatarSet=false。
	// 预期行为：保存去空白后的昵称，保留头像 key，假存储没有任何调用。
	store := &fakeStore{}
	installProfileTestDependencies(t, store)
	oldKey := testOldAvatarKey(7, ".png")
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(_ context.Context, _ uint64, update mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		if update.Nickname != "张三" || update.Signature != "hello" || update.UpdateAvatar {
			t.Fatalf("update = %#v, want trimmed text-only update", update)
		}
		return entity.User{ID: 7, Nickname: update.Nickname, Signature: update.Signature, AvatarObjectKey: &oldKey}, &oldKey, true, nil
	}

	updated, err := UpdateProfile(context.Background(), 7, "  张三  ", "hello", false, nil)
	if err != nil {
		t.Fatalf("UpdateProfile returned an error: %v", err)
	}
	if updated.Nickname != "张三" || store.readKey != "" || len(store.deleted) != 0 {
		t.Fatalf("updated = %#v, storage reads/deletes = %q/%v", updated, store.readKey, store.deleted)
	}
}

func TestUpdateProfileCommitsExactFiveMiBPNGAndDeletesPendingAndOldAvatar(t *testing.T) {
	// 测试目标：验证恰好 5 MiB 的真实 PNG 会被复制到只由服务端写入的 committed key。
	// 构造方法：假存储返回可解码 PNG 和 5 MiB 大小，仓储更新返回 committed key 和事务锁定得到的旧 key。
	// 输入数据：user_id=7、pending png key、昵称张三、签名 hello。
	// 预期行为：读取 pending、写入 committed、数据库保存 committed，并清理旧对象与 pending 对象。
	pendingKey := testAvatarKey(7, ".png")
	committedKey := testCommittedAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	store := &fakeStore{object: storage.Object{Size: MaxAvatarSize, Data: pngBytes(int(MaxAvatarSize))}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(_ context.Context, _ uint64, update mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		if update.AvatarObjectKey == nil || *update.AvatarObjectKey != committedKey {
			t.Fatalf("database avatar = %v, want committed key %q", update.AvatarObjectKey, committedKey)
		}
		return entity.User{ID: 7, Nickname: update.Nickname, Signature: update.Signature, AvatarObjectKey: &committedKey}, &oldKey, true, nil
	}

	updated, err := UpdateProfile(context.Background(), 7, "张三", "hello", true, &pendingKey)
	if err != nil {
		t.Fatalf("UpdateProfile returned an error: %v", err)
	}
	if updated.AvatarObjectKey == nil || *updated.AvatarObjectKey != committedKey || store.readKey != pendingKey || store.writtenKey != committedKey || store.writtenType != "image/png" {
		t.Fatalf("updated/read/write/type = %#v/%q/%q/%q, want committed avatar", updated, store.readKey, store.writtenKey, store.writtenType)
	}
	if len(store.deleted) != 2 || store.deleted[0] != oldKey || store.deleted[1] != pendingKey {
		t.Fatalf("deleted = %v, want old key then pending key", store.deleted)
	}
}

func TestUpdateProfileRejectsOversizedAvatarAndDeletesUnreferencedObject(t *testing.T) {
	// 测试目标：验证超过 5 MiB 的对象不会写入资料，并会清理尚未被引用的新对象。
	// 构造方法：假存储返回 MaxAvatarSize+1 的对象大小，用户资料始终引用旧头像。
	// 输入数据：当前用户合法的新 png key。
	// 预期行为：返回 ErrAvatarTooLarge，不调用资料更新，并删除新 key。
	newKey := testAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	store := &fakeStore{object: storage.Object{Size: MaxAvatarSize + 1}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(context.Context, uint64, mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		t.Fatal("UpdateUserProfile should not be called")
		return entity.User{}, nil, false, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &newKey)
	if !errors.Is(err, ErrAvatarTooLarge) {
		t.Fatalf("error = %v, want ErrAvatarTooLarge", err)
	}
	if len(store.deleted) != 1 || store.deleted[0] != newKey {
		t.Fatalf("deleted = %v, want rejected new key", store.deleted)
	}
}

func TestUpdateProfileRejectsMissingAvatarObjectAndAttemptsCleanup(t *testing.T) {
	// 测试目标：验证数据库不会引用对象存储中不存在的新头像。
	// 构造方法：假存储读取返回 storage.ErrObjectNotFound，用户资料继续引用旧 key。
	// 输入数据：当前用户命名空间中的合法 png key。
	// 预期行为：返回 ErrAvatarNotFound，不调用资料更新，并尝试删除新 key。
	newKey := testAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	store := &fakeStore{readErr: storage.ErrObjectNotFound}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(context.Context, uint64, mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		t.Fatal("UpdateUserProfile should not be called")
		return entity.User{}, nil, false, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &newKey)
	if !errors.Is(err, ErrAvatarNotFound) {
		t.Fatalf("error = %v, want ErrAvatarNotFound", err)
	}
	if len(store.deleted) != 1 || store.deleted[0] != newKey {
		t.Fatalf("deleted = %v, want missing new key cleanup attempt", store.deleted)
	}
}

func TestUpdateProfileRejectsImageWhoseBytesDoNotMatchKeyExtension(t *testing.T) {
	// 测试目标：验证保存资料时按真实文件头校验，拒绝伪造扩展名的图片。
	// 构造方法：为 .png key 返回 JPEG 魔数，并让数据库继续引用旧头像。
	// 输入数据：当前用户合法的 png key，内容前三字节为 FF D8 FF。
	// 预期行为：返回 ErrUnsupportedAvatar，且清理伪装的新对象。
	newKey := testAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	store := &fakeStore{object: storage.Object{Size: 3, Data: []byte{0xff, 0xd8, 0xff}}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &newKey)
	if !errors.Is(err, ErrUnsupportedAvatar) {
		t.Fatalf("error = %v, want ErrUnsupportedAvatar", err)
	}
	if len(store.deleted) != 1 || store.deleted[0] != newKey {
		t.Fatalf("deleted = %v, want rejected new key", store.deleted)
	}
}

func TestUpdateProfileRejectsTruncatedImageWithValidPNGSignature(t *testing.T) {
	// 测试目标：验证只有 PNG 文件签名而缺少可解码图像数据的对象不会被当作有效头像。
	// 构造方法：向假存储提供仅含 PNG 签名的文件，并使仓储保持原头像不变。
	// 输入数据：合法 pending .png key 和 8 字节 PNG 签名。
	// 预期行为：完整图像解码失败，资料更新被拒绝并尝试删除 pending 对象。
	newKey := testAvatarKey(7, ".png")
	oldKey := testOldAvatarKey(7, ".png")
	store := &fakeStore{object: storage.Object{
		Size: 8,
		Data: []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'},
	}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(context.Context, uint64, mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		t.Fatal("UpdateUserProfile should not be called")
		return entity.User{}, nil, false, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &newKey)
	if !errors.Is(err, ErrUnsupportedAvatar) {
		t.Fatalf("error = %v, want ErrUnsupportedAvatar", err)
	}
	if len(store.deleted) != 1 || store.deleted[0] != newKey {
		t.Fatalf("deleted = %v, want rejected pending key", store.deleted)
	}
}

func TestUpdateProfileRejectsAnotherUsersAvatarWithoutDeletingIt(t *testing.T) {
	// 测试目标：验证用户不能引用或删除其他用户命名空间中的对象。
	// 构造方法：当前用户为 7，但提交 key 位于 avatars/pending/8/，并配置可记录调用的假存储。
	// 输入数据：avatars/pending/8/ 下格式合法的 png key。
	// 预期行为：返回 ErrAvatarKeyForbidden，不读取也不删除该对象。
	foreignKey := testAvatarKey(8, ".png")
	store := &fakeStore{}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7}, true, nil
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &foreignKey)
	if !errors.Is(err, ErrAvatarKeyForbidden) {
		t.Fatalf("error = %v, want ErrAvatarKeyForbidden", err)
	}
	if store.readKey != "" || len(store.deleted) != 0 {
		t.Fatalf("storage read/deletes = %q/%v, want none", store.readKey, store.deleted)
	}
}

func TestUpdateProfileReprocessesPendingObjectIntoFreshCommittedKey(t *testing.T) {
	// 测试目标：验证 pending 对象在清理失败后再次提交会生成独立的服务端只写对象 key。
	// 构造方法：保留有效 PNG pending 对象并让资料仓储报告当前和新对象 key 不同。
	// 输入数据：当前用户旧头像、同一 pending PNG、新昵称和新签名。
	// 预期行为：重新校验并复制图片到 committed key，保存新 key 并清理旧对象和 pending 对象。
	pendingKey := testAvatarKey(7, ".png")
	committedKey := testCommittedAvatarKey(7, ".png")
	oldKey := testOldAvatarKey(7, ".png")
	data := pngBytes(100)
	store := &fakeStore{object: storage.Object{Size: int64(len(data)), Data: data}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(_ context.Context, _ uint64, update mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		if update.AvatarObjectKey == nil || *update.AvatarObjectKey != committedKey {
			t.Fatalf("database avatar = %v, want newly generated committed key", update.AvatarObjectKey)
		}
		return entity.User{ID: 7, Nickname: update.Nickname, Signature: update.Signature, AvatarObjectKey: &committedKey}, &oldKey, true, nil
	}

	updated, err := UpdateProfile(context.Background(), 7, "新昵称", "新签名", true, &pendingKey)
	if err != nil {
		t.Fatalf("UpdateProfile returned an error: %v", err)
	}
	if updated.Nickname != "新昵称" || store.readKey != pendingKey || store.writtenKey != committedKey || len(store.deleted) != 2 || store.deleted[0] != oldKey || store.deleted[1] != pendingKey {
		t.Fatalf("updated/storage = %#v read=%q write=%q deleted=%v", updated, store.readKey, store.writtenKey, store.deleted)
	}
}

func TestUpdateProfileDatabaseFailureKeepsPossiblyCommittedFinalAndDeletesPending(t *testing.T) {
	// 测试目标：验证数据库结果不确定时只清理 pending，不删除可能已被数据库引用的 committed 对象。
	// 构造方法：成功读取和写入 final 后，让资料事务返回 commit result unknown。
	// 输入数据：合法 PNG pending 对象和数据库提交结果不确定错误。
	// 预期行为：返回错误，删除列表只有 pending key，committed key 保留为可能的孤儿对象。
	pendingKey := testAvatarKey(7, ".png")
	committedKey := testCommittedAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	data := pngBytes(100)
	store := &fakeStore{object: storage.Object{Size: int64(len(data)), Data: data}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(context.Context, uint64, mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		return entity.User{}, nil, false, errors.New("commit result unknown")
	}

	_, err := UpdateProfile(context.Background(), 7, "张三", "", true, &pendingKey)
	if err == nil {
		t.Fatal("UpdateProfile returned nil error")
	}
	if store.writtenKey != committedKey || len(store.deleted) != 1 || store.deleted[0] != pendingKey {
		t.Fatalf("written/deleted = %q/%v, want committed retained and pending deleted", store.writtenKey, store.deleted)
	}
}

func TestUpdateProfileIgnoresOldAvatarDeleteFailure(t *testing.T) {
	// 测试目标：验证资料保存成功后旧对象删除失败不会回滚或改写成功结果。
	// 构造方法：资料仓储成功切换到新 key，假存储在删除旧 key 时返回网络错误。
	// 输入数据：合法 PNG 新对象、旧头像 key 和 delete failed 错误。
	// 预期行为：UpdateProfile 仍返回新资料且 error=nil，并记录了一次删除尝试。
	pendingKey := testAvatarKey(7, ".png")
	committedKey := testCommittedAvatarKey(7, ".png")
	oldKey := "avatars/committed/7/ffeeddccbbaa99887766554433221100.png"
	data := pngBytes(100)
	store := &fakeStore{object: storage.Object{Size: int64(len(data)), Data: data}, deleteErr: errors.New("delete failed")}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &oldKey}, true, nil
	}
	updateUserProfile = func(_ context.Context, _ uint64, update mysql.UserProfileUpdate) (entity.User, *string, bool, error) {
		return entity.User{ID: 7, Nickname: update.Nickname, AvatarObjectKey: &committedKey}, &oldKey, true, nil
	}

	updated, err := UpdateProfile(context.Background(), 7, "张三", "", true, &pendingKey)
	if err != nil {
		t.Fatalf("UpdateProfile returned an error: %v", err)
	}
	if updated.AvatarObjectKey == nil || *updated.AvatarObjectKey != committedKey || len(store.deleted) != 2 || store.deleted[0] != oldKey || store.deleted[1] != pendingKey {
		t.Fatalf("updated/deleted = %#v/%v, want successful profile and cleanup attempts", updated, store.deleted)
	}
}
