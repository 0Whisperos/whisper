package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model"
	"golang.org/x/crypto/bcrypt"
)

func TestServiceLoginIssuesJwtAndStoresRefreshTokenHash(t *testing.T) {
	// 测试目标：验证登录成功会签发 JWT access token、生成 opaque refresh token，并只保存 refresh token hash。
	// 构造方法：使用 fake 用户仓储、refresh token 仓储、chat 节点选择器和固定时钟创建认证服务。
	// 输入数据：账号 12345678、密码 secret、chat ws 地址 ws://127.0.0.1:9001/ws。
	// 预期行为：返回 access_token、refresh_token、access_token_expires_at、im_chat_ws_url，且 refresh token 仓储没有保存明文。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	passwordHash := hashPasswordForTest(t, "secret")
	refreshStore := newRefreshStoreRecorder()
	service := NewService(ServiceConfig{
		FindUserByAccount: fakeFindUserByAccount(model.User{
			ID:           20001,
			Account:      "12345678",
			PasswordHash: passwordHash,
		}, true, nil),
		SaveRefreshToken:           refreshStore.Save,
		FindRefreshToken:           refreshStore.Find,
		UpdateRefreshTokenLastUsed: refreshStore.UpdateLastUsedAt,
		DeleteRefreshToken:         refreshStore.Delete,
		SelectReadyChatNode:        fakeSelectReadyChatNode("ws://127.0.0.1:9001/ws", nil),
		Now:                        func() time.Time { return now },
		JWTSecret:                  []byte("test-secret-with-enough-length"),
		AccessTokenTTL:             15 * time.Minute,
		RefreshTokenTTL:            30 * 24 * time.Hour,
	})

	result, err := service.Login(context.Background(), "12345678", "secret")
	if err != nil {
		t.Fatalf("Login returned an error: %v", err)
	}

	if result.RefreshToken == "" {
		t.Fatal("RefreshToken is empty")
	}
	if result.AccessToken == "" {
		t.Fatal("AccessToken is empty")
	}
	if result.AccessTokenExpiresAt != now.Add(15*time.Minute) {
		t.Fatalf("AccessTokenExpiresAt = %v, want %v", result.AccessTokenExpiresAt, now.Add(15*time.Minute))
	}
	if result.IMChatWSURL != "ws://127.0.0.1:9001/ws" {
		t.Fatalf("IMChatWSURL = %q, want ws://127.0.0.1:9001/ws", result.IMChatWSURL)
	}
	if refreshStore.saved.TokenHash == "" {
		t.Fatal("refresh token hash was not saved")
	}
	if refreshStore.saved.TokenHash == result.RefreshToken {
		t.Fatal("refresh token store saved the raw refresh token")
	}
	if refreshStore.saved.UserID != 20001 {
		t.Fatalf("saved user id = %d, want 20001", refreshStore.saved.UserID)
	}
	if refreshStore.saved.ExpiresAt != now.Add(30*24*time.Hour) {
		t.Fatalf("saved refresh expiry = %v, want %v", refreshStore.saved.ExpiresAt, now.Add(30*24*time.Hour))
	}
	if refreshStore.savedTTL != 30*24*time.Hour {
		t.Fatalf("saved TTL = %v, want 720h", refreshStore.savedTTL)
	}

	claims, err := service.VerifyAccessToken(result.AccessToken)
	if err != nil {
		t.Fatalf("VerifyAccessToken returned an error: %v", err)
	}
	if claims.UserID != 20001 {
		t.Fatalf("claims user id = %d, want 20001", claims.UserID)
	}
	if !claims.ExpiresAt.Equal(result.AccessTokenExpiresAt) {
		t.Fatalf("claims expiry = %v, want %v", claims.ExpiresAt, result.AccessTokenExpiresAt)
	}
}

func TestServiceRefreshDoesNotRotateRefreshToken(t *testing.T) {
	// 测试目标：验证 refresh 成功只签发新的 access token，不生成或轮换 refresh token。
	// 构造方法：fake refresh token 仓储预置一个 token hash 对应的状态，并记录 Save/Delete 调用次数。
	// 输入数据：refresh token raw-refresh-token。
	// 预期行为：返回新的 access token 和 chat ws 地址，只更新 last_used_at，不调用 Save 或 Delete。
	now := time.Date(2026, 8, 16, 13, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	refreshStore := newRefreshStoreRecorder()
	refreshStore.record = RefreshTokenRecord{
		UserID:    20001,
		IssuedAt:  now.Add(-time.Hour),
		ExpiresAt: now.Add(29 * 24 * time.Hour),
	}
	refreshStore.found = true
	service := NewService(ServiceConfig{
		FindUserByAccount:          fakeFindUserByAccount(model.User{}, false, nil),
		SaveRefreshToken:           refreshStore.Save,
		FindRefreshToken:           refreshStore.Find,
		UpdateRefreshTokenLastUsed: refreshStore.UpdateLastUsedAt,
		DeleteRefreshToken:         refreshStore.Delete,
		SelectReadyChatNode:        fakeSelectReadyChatNode("ws://127.0.0.1:9001/ws", nil),
		Now:                        func() time.Time { return now },
		JWTSecret:                  []byte("test-secret-with-enough-length"),
		AccessTokenTTL:             15 * time.Minute,
		RefreshTokenTTL:            30 * 24 * time.Hour,
	})

	result, err := service.Refresh(context.Background(), "raw-refresh-token")
	if err != nil {
		t.Fatalf("Refresh returned an error: %v", err)
	}

	if result.RefreshToken != "" {
		t.Fatalf("RefreshToken = %q, want empty", result.RefreshToken)
	}
	if result.AccessToken == "" {
		t.Fatal("AccessToken is empty")
	}
	if refreshStore.saveCalls != 0 {
		t.Fatalf("Save calls = %d, want 0", refreshStore.saveCalls)
	}
	if refreshStore.deleteCalls != 0 {
		t.Fatalf("Delete calls = %d, want 0", refreshStore.deleteCalls)
	}
	if refreshStore.lastUsedAt == nil || !refreshStore.lastUsedAt.Equal(now) {
		t.Fatalf("last_used_at = %v, want %v", refreshStore.lastUsedAt, now)
	}
}

func TestServiceRefreshRejectsMissingRefreshToken(t *testing.T) {
	// 测试目标：验证不存在的 refresh token 会返回稳定 invalid_refresh_token 错误。
	// 构造方法：fake refresh token 仓储返回 found=false。
	// 输入数据：refresh token missing-token。
	// 预期行为：错误可通过 errors.Is 判断为 ErrInvalidRefreshToken。
	service := NewService(ServiceConfig{
		FindUserByAccount:          fakeFindUserByAccount(model.User{}, false, nil),
		SaveRefreshToken:           newRefreshStoreRecorder().Save,
		FindRefreshToken:           newRefreshStoreRecorder().Find,
		UpdateRefreshTokenLastUsed: newRefreshStoreRecorder().UpdateLastUsedAt,
		DeleteRefreshToken:         newRefreshStoreRecorder().Delete,
		SelectReadyChatNode:        fakeSelectReadyChatNode("ws://127.0.0.1:9001/ws", nil),
		Now:                        func() time.Time { return time.Date(2026, 8, 16, 13, 0, 0, 0, time.UTC) },
		JWTSecret:                  []byte("test-secret-with-enough-length"),
		AccessTokenTTL:             15 * time.Minute,
		RefreshTokenTTL:            30 * 24 * time.Hour,
	})

	_, err := service.Refresh(context.Background(), "missing-token")

	if !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("Refresh error = %v, want ErrInvalidRefreshToken", err)
	}
}

func TestServiceLogoutDeletesRefreshTokenHash(t *testing.T) {
	// 测试目标：验证主动退出登录删除 refresh token hash，而不是 access token session。
	// 构造方法：使用 fake refresh token 仓储记录 Delete 入参。
	// 输入数据：refresh token raw-refresh-token。
	// 预期行为：Delete 被调用一次，且删除的是非空 hash，不是明文 token。
	refreshStore := newRefreshStoreRecorder()
	service := NewService(ServiceConfig{
		FindUserByAccount:          fakeFindUserByAccount(model.User{}, false, nil),
		SaveRefreshToken:           refreshStore.Save,
		FindRefreshToken:           refreshStore.Find,
		UpdateRefreshTokenLastUsed: refreshStore.UpdateLastUsedAt,
		DeleteRefreshToken:         refreshStore.Delete,
		SelectReadyChatNode:        fakeSelectReadyChatNode("ws://127.0.0.1:9001/ws", nil),
		Now:                        func() time.Time { return time.Date(2026, 8, 16, 13, 0, 0, 0, time.UTC) },
		JWTSecret:                  []byte("test-secret-with-enough-length"),
		AccessTokenTTL:             15 * time.Minute,
		RefreshTokenTTL:            30 * 24 * time.Hour,
	})

	err := service.Logout(context.Background(), "raw-refresh-token")
	if err != nil {
		t.Fatalf("Logout returned an error: %v", err)
	}

	if refreshStore.deleteCalls != 1 {
		t.Fatalf("Delete calls = %d, want 1", refreshStore.deleteCalls)
	}
	if refreshStore.deletedHash == "" {
		t.Fatal("deleted hash is empty")
	}
	if refreshStore.deletedHash == "raw-refresh-token" {
		t.Fatal("Delete received the raw refresh token")
	}
}

func hashPasswordForTest(t *testing.T, password string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	return string(hash)
}

func fakeFindUserByAccount(user model.User, found bool, err error) FindUserByAccountFunc {
	return func(_ context.Context, _ string) (model.User, bool, error) {
		return user, found, err
	}
}

type refreshStoreRecorder struct {
	record      RefreshTokenRecord
	found       bool
	saved       RefreshTokenRecord
	savedTTL    time.Duration
	saveCalls   int
	deleteCalls int
	deletedHash string
	lastUsedAt  *time.Time
}

func newRefreshStoreRecorder() *refreshStoreRecorder {
	return &refreshStoreRecorder{}
}

func (store *refreshStoreRecorder) Save(_ context.Context, record RefreshTokenRecord, ttl time.Duration) error {
	store.saveCalls++
	store.saved = record
	store.savedTTL = ttl
	return nil
}

func (store *refreshStoreRecorder) Find(_ context.Context, _ string) (RefreshTokenRecord, bool, error) {
	return store.record, store.found, nil
}

func (store *refreshStoreRecorder) UpdateLastUsedAt(_ context.Context, _ string, usedAt time.Time) error {
	store.lastUsedAt = &usedAt
	return nil
}

func (store *refreshStoreRecorder) Delete(_ context.Context, tokenHash string) error {
	store.deleteCalls++
	store.deletedHash = tokenHash
	return nil
}

func fakeSelectReadyChatNode(url string, err error) SelectReadyChatNodeFunc {
	return func(_ context.Context) (string, error) {
		if err != nil {
			return "", err
		}
		return url, nil
	}
}
