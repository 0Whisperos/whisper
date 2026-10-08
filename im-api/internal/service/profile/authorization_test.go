package profile

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

func TestAuthorizeAvatarUploadReturnsUserScopedKeyAndSignedRequest(t *testing.T) {
	// 测试目标：验证上传授权由服务端生成当前用户专属 key，并保留签名请求信息。
	// 构造方法：固定随机源并让假存储返回 PUT URL 和过期时间。
	// 输入数据：user_id=7、content_type=image/png。
	// 预期行为：key 位于 avatars/pending/7/ 且以 .png 结尾，签名使用规范化 image/png。
	store := &fakeStore{putRequest: storage.PresignedRequest{Method: "PUT", URL: "https://storage/upload", Headers: map[string]string{"Content-Type": "image/png"}, ExpiresAt: time.Unix(100, 0)}}
	installProfileTestDependencies(t, store)
	randomRead = func(data []byte) (int, error) {
		for index := range data {
			data[index] = byte(index)
		}
		return len(data), nil
	}

	authorization, err := AuthorizeAvatarUpload(context.Background(), 7, "image/png")
	if err != nil {
		t.Fatalf("AuthorizeAvatarUpload returned an error: %v", err)
	}
	if !strings.HasPrefix(authorization.ObjectKey, "avatars/pending/7/") || !strings.HasSuffix(authorization.ObjectKey, ".png") {
		t.Fatalf("ObjectKey = %q, want user-scoped png key", authorization.ObjectKey)
	}
	if store.putKey != authorization.ObjectKey || store.putType != "image/png" || authorization.URL != "https://storage/upload" {
		t.Fatalf("authorization = %#v, store key/type = %q/%q", authorization, store.putKey, store.putType)
	}
}

func TestAuthorizeAvatarUploadRejectsNonPNGContentType(t *testing.T) {
	// 测试目标：验证上传授权只接受 PNG 元数据。
	// 构造方法：配置假存储，并提交非 PNG 的 Content-Type。
	// 输入数据：user_id=7、content_type=image/jpeg。
	// 预期行为：返回 ErrInvalidAvatar，且不生成存储签名。
	store := &fakeStore{}
	installProfileTestDependencies(t, store)

	_, err := AuthorizeAvatarUpload(context.Background(), 7, "image/jpeg")
	if !errors.Is(err, ErrInvalidAvatar) {
		t.Fatalf("error = %v, want ErrInvalidAvatar", err)
	}
	if store.putKey != "" {
		t.Fatalf("PresignPut key = %q, want no call", store.putKey)
	}
}

func TestAuthorizeAvatarDownloadSignsOnlyCurrentDatabaseAvatar(t *testing.T) {
	// 测试目标：验证下载授权只针对数据库当前记录的头像 key 签发。
	// 构造方法：让用户仓储返回一个当前头像，并让假存储返回短期 GET URL。
	// 输入数据：user_id=7，当前 key 位于 avatars/7/，下载 URL 为 https://storage/download。
	// 预期行为：PresignGet 收到当前 key，响应包含同一 key、URL 和过期时间。
	key := testAvatarKey(7, ".webp")
	store := &fakeStore{getRequest: storage.PresignedRequest{Method: "GET", URL: "https://storage/download", ExpiresAt: time.Unix(200, 0)}}
	installProfileTestDependencies(t, store)
	findUserByID = func(uint64) (entity.User, bool, error) {
		return entity.User{ID: 7, AvatarObjectKey: &key}, true, nil
	}

	authorization, err := AuthorizeAvatarDownload(context.Background(), 7)
	if err != nil {
		t.Fatalf("AuthorizeAvatarDownload returned an error: %v", err)
	}
	if store.getKey != key || authorization.ObjectKey != key || authorization.URL != "https://storage/download" {
		t.Fatalf("authorization/store key = %#v/%q, want current avatar", authorization, store.getKey)
	}
}
