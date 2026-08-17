package redis

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func TestRefreshTokenRepositorySaveStoresProtocolJSONWithTTL(t *testing.T) {
	// 测试目标：验证 refresh token repository 保存协议 JSON，并设置 Redis TTL。
	// 构造方法：启动 miniredis，用 go-redis client 创建 repository 后保存一条 refresh token 记录。
	// 输入数据：tokenHash=hash-1，userID=20001，TTL=30m，issued_at/expires_at 使用 +08:00 固定时间。
	// 预期行为：Redis 中存在 refresh_token:hash-1，JSON 字段为 user_id/issued_at/expires_at，且 TTL 大于 0。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewRefreshTokenRepository(client)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))

	err := repository.Save(context.Background(), auth.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute)
	if err != nil {
		t.Fatalf("Save returned an error: %v", err)
	}

	raw, err := server.Get("refresh_token:hash-1")
	if err != nil {
		t.Fatalf("read stored refresh token: %v", err)
	}
	var value map[string]string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("unmarshal stored JSON: %v", err)
	}
	if value["user_id"] != "20001" {
		t.Fatalf("user_id = %q, want 20001", value["user_id"])
	}
	if value["issued_at"] != "2026-08-16T12:00:00+08:00" {
		t.Fatalf("issued_at = %q, want 2026-08-16T12:00:00+08:00", value["issued_at"])
	}
	if value["expires_at"] != "2026-08-16T12:30:00+08:00" {
		t.Fatalf("expires_at = %q, want 2026-08-16T12:30:00+08:00", value["expires_at"])
	}
	if server.TTL("refresh_token:hash-1") <= 0 {
		t.Fatal("refresh token key has no TTL")
	}
}

func TestRefreshTokenRepositoryFindReturnsMissingForRedisNil(t *testing.T) {
	// 测试目标：验证 Redis key 不存在时返回 found=false，而不是泄漏 go-redis 的 redis.Nil。
	// 构造方法：启动空 miniredis，调用 Find 查询不存在的 token hash。
	// 输入数据：tokenHash=missing-hash。
	// 预期行为：found=false，error=nil。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewRefreshTokenRepository(client)

	_, found, err := repository.Find(context.Background(), "missing-hash")

	if err != nil {
		t.Fatalf("Find returned an error: %v", err)
	}
	if found {
		t.Fatal("found = true, want false")
	}
}

func TestRefreshTokenRepositoryUpdateLastUsedAtKeepsTTL(t *testing.T) {
	// 测试目标：验证更新 last_used_at 时保留原 refresh token TTL。
	// 构造方法：保存 refresh token 后记录 TTL，调用 UpdateLastUsedAt，再读取 JSON 和 TTL。
	// 输入数据：tokenHash=hash-1，last_used_at=2026-08-16T12:05:00+08:00。
	// 预期行为：JSON 包含 last_used_at，TTL 仍然存在且不超过原 TTL。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewRefreshTokenRepository(client)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	if err := repository.Save(context.Background(), auth.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("Save returned an error: %v", err)
	}
	beforeTTL := server.TTL("refresh_token:hash-1")

	usedAt := now.Add(5 * time.Minute)
	if err := repository.UpdateLastUsedAt(context.Background(), "hash-1", usedAt); err != nil {
		t.Fatalf("UpdateLastUsedAt returned an error: %v", err)
	}

	var value refreshTokenValue
	raw, err := server.Get("refresh_token:hash-1")
	if err != nil {
		t.Fatalf("read stored refresh token: %v", err)
	}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("unmarshal stored JSON: %v", err)
	}
	if value.LastUsedAt == nil || *value.LastUsedAt != "2026-08-16T12:05:00+08:00" {
		t.Fatalf("last_used_at = %v, want 2026-08-16T12:05:00+08:00", value.LastUsedAt)
	}
	afterTTL := server.TTL("refresh_token:hash-1")
	if afterTTL <= 0 || beforeTTL <= 0 {
		t.Fatal("refresh token key lost TTL")
	}
}

func TestRefreshTokenRepositoryUpdateMissingReturnsInvalidRefreshToken(t *testing.T) {
	// 测试目标：验证更新不存在的 refresh token 时返回 auth.ErrInvalidRefreshToken。
	// 构造方法：启动空 miniredis，调用 UpdateLastUsedAt。
	// 输入数据：tokenHash=missing-hash。
	// 预期行为：错误可通过 errors.Is 判定为 ErrInvalidRefreshToken。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewRefreshTokenRepository(client)

	err := repository.UpdateLastUsedAt(context.Background(), "missing-hash", time.Now())

	if !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("UpdateLastUsedAt error = %v, want ErrInvalidRefreshToken", err)
	}
}

func TestRefreshTokenRepositoryDeleteRemovesKey(t *testing.T) {
	// 测试目标：验证 logout 通过 repository 删除 refresh token Redis key。
	// 构造方法：先保存 refresh token，再调用 Delete。
	// 输入数据：tokenHash=hash-1。
	// 预期行为：Redis 中 refresh_token:hash-1 不再存在。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewRefreshTokenRepository(client)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	if err := repository.Save(context.Background(), auth.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("Save returned an error: %v", err)
	}

	if err := repository.Delete(context.Background(), "hash-1"); err != nil {
		t.Fatalf("Delete returned an error: %v", err)
	}

	if server.Exists("refresh_token:hash-1") {
		t.Fatal("refresh token key still exists")
	}
}

func newRedisServer(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	return server
}

func newTestClient(t *testing.T, server *miniredis.Miniredis) *goredis.Client {
	t.Helper()
	client := Open(Config{Addr: server.Addr()})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Fatalf("close Redis client: %v", err)
		}
	})
	return client
}
