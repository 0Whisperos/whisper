package redis

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func TestRefreshTokenRepositorySaveStoresProtocolJSONWithTTL(t *testing.T) {
	// 测试目标：验证 refresh token repository 保存协议 JSON，并设置 Redis TTL。
	// 构造方法：启动 miniredis，把测试 client 写入 global.RedisClient 后保存一条 refresh token 记录。
	// 输入数据：tokenHash=hash-1，userID=20001，TTL=30m，issued_at/expires_at 使用 +08:00 固定时间。
	// 预期行为：Redis 中存在 refresh_token:hash-1，JSON 字段包含 user_id/issued_at/expires_at，且 TTL 大于 0。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))

	err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute)
	if err != nil {
		t.Fatalf("SaveRefreshToken returned an error: %v", err)
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
	indexValue, err := server.Get("refresh_token_by_user:20001")
	if err != nil {
		t.Fatalf("read refresh token user index: %v", err)
	}
	if indexValue != "hash-1" {
		t.Fatalf("refresh token user index = %q, want hash-1", indexValue)
	}
	if server.TTL("refresh_token_by_user:20001") <= 0 {
		t.Fatal("refresh token user index has no TTL")
	}
}

func TestRefreshTokenRepositoryFindReturnsMissingForRedisNil(t *testing.T) {
	// 测试目标：验证 Redis key 不存在时返回 found=false，而不是泄漏 go-redis 的 redis.Nil。
	// 构造方法：启动空 miniredis，把测试 client 写入 global.RedisClient 后查询不存在的 token hash。
	// 输入数据：tokenHash=missing-hash。
	// 预期行为：found=false，error=nil。
	server := newRedisServer(t)
	setTestClient(t, server)

	_, found, err := FindRefreshToken("missing-hash")

	if err != nil {
		t.Fatalf("FindRefreshToken returned an error: %v", err)
	}
	if found {
		t.Fatal("found = true, want false")
	}
}

func TestRefreshTokenRepositoryUpdateLastUsedAtKeepsTTL(t *testing.T) {
	// 测试目标：验证更新 last_used_at 时保留原 refresh token TTL。
	// 构造方法：保存 refresh token 后记录 TTL，调用 UpdateRefreshTokenLastUsedAt，再读取 JSON 和 TTL。
	// 输入数据：tokenHash=hash-1，last_used_at=2026-08-16T12:05:00+08:00。
	// 预期行为：JSON 包含 last_used_at，TTL 仍然存在。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken returned an error: %v", err)
	}
	beforeTTL := server.TTL("refresh_token:hash-1")

	usedAt := now.Add(5 * time.Minute)
	if err := UpdateRefreshTokenLastUsedAt("hash-1", usedAt); err != nil {
		t.Fatalf("UpdateRefreshTokenLastUsedAt returned an error: %v", err)
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
	// 测试目标：验证更新不存在的 refresh token 时返回 ErrRefreshTokenNotFound。
	// 构造方法：启动空 miniredis，把测试 client 写入 global.RedisClient 后调用 UpdateRefreshTokenLastUsedAt。
	// 输入数据：tokenHash=missing-hash。
	// 预期行为：错误可通过 errors.Is 判定为 ErrRefreshTokenNotFound。
	server := newRedisServer(t)
	setTestClient(t, server)

	err := UpdateRefreshTokenLastUsedAt("missing-hash", time.Now())

	if !errors.Is(err, ErrRefreshTokenNotFound) {
		t.Fatalf("UpdateRefreshTokenLastUsedAt error = %v, want ErrRefreshTokenNotFound", err)
	}
}

func TestRefreshTokenRepositoryDeleteRemovesTokenAndUserIndex(t *testing.T) {
	// 测试目标：验证 logout 通过 repository 删除 refresh token 时也会清理 user_id 反向索引。
	// 构造方法：先保存 refresh token，再调用 DeleteRefreshToken。
	// 输入数据：tokenHash=hash-1，userID=20001。
	// 预期行为：Redis 中 refresh_token:hash-1 和 refresh_token_by_user:20001 都不再存在。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken returned an error: %v", err)
	}

	if err := DeleteRefreshToken("hash-1"); err != nil {
		t.Fatalf("DeleteRefreshToken returned an error: %v", err)
	}

	if server.Exists("refresh_token:hash-1") {
		t.Fatal("refresh token key still exists")
	}
	if server.Exists("refresh_token_by_user:20001") {
		t.Fatal("refresh token user index still exists")
	}
}

func TestRefreshTokenRepositoryDeleteDoesNotRemoveIndexForNewerToken(t *testing.T) {
	// 测试目标：验证按 token hash 删除旧 token 时不会误删同用户更新后的反向索引。
	// 构造方法：先保存旧 token，再保存同用户的新 token，最后调用 DeleteRefreshToken 删除旧 token。
	// 输入数据：userID=20001，旧 tokenHash=hash-1，新 tokenHash=hash-2。
	// 预期行为：旧主记录被删除，refresh_token_by_user:20001 仍指向 hash-2。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken old token returned an error: %v", err)
	}
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-2",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken new token returned an error: %v", err)
	}

	if err := DeleteRefreshToken("hash-1"); err != nil {
		t.Fatalf("DeleteRefreshToken returned an error: %v", err)
	}

	if server.Exists("refresh_token:hash-1") {
		t.Fatal("old refresh token key still exists")
	}
	indexValue, err := server.Get("refresh_token_by_user:20001")
	if err != nil {
		t.Fatalf("read refresh token user index: %v", err)
	}
	if indexValue != "hash-2" {
		t.Fatalf("refresh token user index = %q, want hash-2", indexValue)
	}
}

func TestRefreshTokenRepositoryFindHashByUserReturnsSavedTokenHash(t *testing.T) {
	// 测试目标：验证 repository 可以通过 user_id 找到当前用户最新 refresh token hash。
	// 构造方法：启动 miniredis，保存一条 refresh token 记录，再调用 FindRefreshTokenHashByUser。
	// 输入数据：userID=20001，tokenHash=hash-1。
	// 预期行为：返回 found=true，tokenHash=hash-1。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken returned an error: %v", err)
	}

	tokenHash, found, err := FindRefreshTokenHashByUser(20001)

	if err != nil {
		t.Fatalf("FindRefreshTokenHashByUser returned an error: %v", err)
	}
	if !found {
		t.Fatal("found = false, want true")
	}
	if tokenHash != "hash-1" {
		t.Fatalf("tokenHash = %q, want hash-1", tokenHash)
	}
}

func TestRefreshTokenRepositoryDeleteByUserRemovesTokenAndIndex(t *testing.T) {
	// 测试目标：验证按 user_id 删除 refresh token 时同时删除主记录和反向索引。
	// 构造方法：保存一条 refresh token 记录后调用 DeleteRefreshTokenByUser。
	// 输入数据：userID=20001，tokenHash=hash-1。
	// 预期行为：Redis 中 refresh_token:hash-1 和 refresh_token_by_user:20001 都不存在。
	server := newRedisServer(t)
	setTestClient(t, server)
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	if err := SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: "hash-1",
		UserID:    20001,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * time.Minute),
	}, 30*time.Minute); err != nil {
		t.Fatalf("SaveRefreshToken returned an error: %v", err)
	}

	if err := DeleteRefreshTokenByUser(20001); err != nil {
		t.Fatalf("DeleteRefreshTokenByUser returned an error: %v", err)
	}

	if server.Exists("refresh_token:hash-1") {
		t.Fatal("refresh token key still exists")
	}
	if server.Exists("refresh_token_by_user:20001") {
		t.Fatal("refresh token user index still exists")
	}
}

func TestRefreshTokenRepositoryDeleteByUserRemovesStaleIndex(t *testing.T) {
	// 测试目标：验证旧主记录已经缺失时，按 user_id 删除仍会清理残留反向索引且保持幂等。
	// 构造方法：只写入 refresh_token_by_user:20001，不写入 refresh_token:hash-1，再调用 DeleteRefreshTokenByUser。
	// 输入数据：userID=20001，索引值 hash-1。
	// 预期行为：DeleteRefreshTokenByUser 返回 nil，残留索引被删除。
	server := newRedisServer(t)
	setTestClient(t, server)
	server.Set("refresh_token_by_user:20001", "hash-1")

	if err := DeleteRefreshTokenByUser(20001); err != nil {
		t.Fatalf("DeleteRefreshTokenByUser returned an error: %v", err)
	}

	if server.Exists("refresh_token_by_user:20001") {
		t.Fatal("refresh token user index still exists")
	}
}

func newRedisServer(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	return miniredis.RunT(t)
}

func setTestClient(t *testing.T, server *miniredis.Miniredis) {
	t.Helper()
	oldClient := global.RedisClient
	client := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	global.RedisClient = client
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Fatalf("close Redis client: %v", err)
		}
		global.RedisClient = oldClient
	})
}
