package auth

import (
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	redisrepo "github.com/0Whisperos/whisper/im-server/internal/repository/redis"
	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

func TestLoginDeletesPreviousRefreshTokenForSameUser(t *testing.T) {
	// Test goal: verify password login replaces the user's previous refresh token through the Redis by-user index.
	// Construction: inject a fake user lookup, store one previous refresh token in miniredis, register one ready chat node, then call Login.
	// Input data: account 00123456, password secret, old refresh token old-refresh-token belonging to user 20001.
	// Expected behavior: Login returns a new token for user 20001, deletes the old token key, and updates the by-user index.
	server := newAuthRedisServer(t)
	setAuthRedisClient(t, server)
	setReadyChatNode(server)
	setAuthUserLookup(t, entity.User{ID: 20001, Account: "00123456", PasswordHash: hashPassword(t, "secret")})
	SetTokenConfig([]byte("test-secret"), 15*time.Minute, 30*24*time.Hour)
	saveTestRefreshToken(t, "old-refresh-token", 20001)

	result, err := Login("00123456", "secret")

	if err != nil {
		t.Fatalf("Login returned an error: %v", err)
	}
	if result.UserID != 20001 || result.RefreshToken == "" || result.AccessToken == "" {
		t.Fatalf("result = %#v, want user id and issued tokens", result)
	}
	if server.Exists("refresh_token:" + hashRefreshToken("old-refresh-token")) {
		t.Fatal("old refresh token key still exists")
	}
	if !server.Exists("refresh_token:" + hashRefreshToken(result.RefreshToken)) {
		t.Fatal("new refresh token key does not exist")
	}
	indexValue, err := server.Get("refresh_token_by_user:20001")
	if err != nil {
		t.Fatalf("read refresh token user index: %v", err)
	}
	if indexValue != hashRefreshToken(result.RefreshToken) {
		t.Fatalf("refresh token user index = %q, want new token hash", indexValue)
	}
}

func TestLoginContinuesWhenNoPreviousRefreshTokenExists(t *testing.T) {
	// Test goal: verify first-time password login succeeds when the user has no by-user refresh token index.
	// Construction: inject a fake user lookup and ready chat node without storing any previous refresh token.
	// Input data: account 00123456 and password secret.
	// Expected behavior: Login signs a new session and stores a by-user index for the issued refresh token.
	server := newAuthRedisServer(t)
	setAuthRedisClient(t, server)
	setReadyChatNode(server)
	setAuthUserLookup(t, entity.User{ID: 20001, Account: "00123456", PasswordHash: hashPassword(t, "secret")})
	SetTokenConfig([]byte("test-secret"), 15*time.Minute, 30*24*time.Hour)

	result, err := Login("00123456", "secret")

	if err != nil {
		t.Fatalf("Login returned an error: %v", err)
	}
	if result.UserID != 20001 || result.RefreshToken == "" {
		t.Fatalf("result = %#v, want user id and refresh token", result)
	}
	if !server.Exists("refresh_token:" + hashRefreshToken(result.RefreshToken)) {
		t.Fatal("new refresh token key does not exist")
	}
	if !server.Exists("refresh_token_by_user:20001") {
		t.Fatal("refresh token user index does not exist")
	}
}

func newAuthRedisServer(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	return miniredis.RunT(t)
}

func setAuthRedisClient(t *testing.T, server *miniredis.Miniredis) {
	t.Helper()
	oldClient := global.RedisClient
	global.RedisClient = goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if err := global.RedisClient.Close(); err != nil {
			t.Fatalf("close Redis client: %v", err)
		}
		global.RedisClient = oldClient
	})
}

func setReadyChatNode(server *miniredis.Miniredis) {
	server.HSet("chat_nodes:chat-001", "node_id", "chat-001")
	server.HSet("chat_nodes:chat-001", "public_ws_url", "ws://127.0.0.1:9001/ws")
	server.HSet("chat_nodes:chat-001", "rpc_addr", "127.0.0.1:9101")
	server.HSet("chat_nodes:chat-001", "state", "ready")
	server.HSet("chat_nodes:chat-001", "started_at", "2026-08-16T12:00:00+08:00")
	server.HSet("chat_nodes:chat-001", "last_heartbeat_at", "2026-08-16T12:00:10+08:00")
}

func setAuthUserLookup(t *testing.T, user entity.User) {
	t.Helper()
	oldLookup := findUserByAccount
	findUserByAccount = func(account string) (entity.User, bool, error) {
		if account != user.Account {
			return entity.User{}, false, nil
		}
		return user, true, nil
	}
	t.Cleanup(func() {
		findUserByAccount = oldLookup
	})
}

func saveTestRefreshToken(t *testing.T, refreshToken string, userID uint64) {
	t.Helper()
	now := time.Now()
	err := redisrepo.SaveRefreshToken(authmodel.RefreshTokenRecord{
		TokenHash: hashRefreshToken(refreshToken),
		UserID:    userID,
		IssuedAt:  now,
		ExpiresAt: now.Add(30 * 24 * time.Hour),
	}, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("save test refresh token: %v", err)
	}
}

func hashPassword(t *testing.T, password string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	return string(hash)
}
