package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	mysqlrepo "github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
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

func TestRegisterCreatesTrimmedNicknameWithDefaultCostPasswordHash(t *testing.T) {
	// 测试目标：验证注册会去除昵称首尾空白、生成带前导零的账号，并保存可验证的 bcrypt DefaultCost 密码哈希。
	// 构造方法：注入固定账号生成器和用户创建替身，捕获服务提交的用户实体后调用 Register。
	// 输入数据：nickname="  张三  "、password="secret"，生成账号固定为 00123456。
	// 预期行为：返回固定账号，保存昵称为张三，密码哈希不是明文且可验证，哈希成本为 DefaultCost。
	oldGenerator := generateRegisterAccount
	oldCreateUser := createRegisterUser
	generateRegisterAccount = func() (string, error) { return "00123456", nil }
	var created entity.User
	createRegisterUser = func(user *entity.User) error {
		created = *user
		return nil
	}
	t.Cleanup(func() {
		generateRegisterAccount = oldGenerator
		createRegisterUser = oldCreateUser
	})

	account, err := Register("  张三  ", "secret")
	if err != nil {
		t.Fatalf("Register returned an error: %v", err)
	}
	if account != "00123456" || created.Account != account {
		t.Fatalf("account = %q, created account = %q, want 00123456", account, created.Account)
	}
	if created.Nickname != "张三" {
		t.Fatalf("nickname = %q, want trimmed nickname 张三", created.Nickname)
	}
	if created.PasswordHash == "secret" || bcrypt.CompareHashAndPassword([]byte(created.PasswordHash), []byte("secret")) != nil {
		t.Fatal("stored password hash does not verify the original password")
	}
	cost, err := bcrypt.Cost([]byte(created.PasswordHash))
	if err != nil {
		t.Fatalf("read bcrypt cost: %v", err)
	}
	if cost != bcrypt.DefaultCost {
		t.Fatalf("bcrypt cost = %d, want %d", cost, bcrypt.DefaultCost)
	}
}

func TestRegisterRetriesAfterDuplicateAccount(t *testing.T) {
	// 测试目标：验证数据库唯一键冲突会触发重新生成账号，并在后续尝试成功后只返回新账号。
	// 构造方法：注入依次返回两个账号的生成器，让第一次创建返回重复错误、第二次创建成功。
	// 输入数据：nickname=张三、password=secret，账号依次为 00123456 和 00123457。
	// 预期行为：创建函数被调用两次，最终返回 00123457，且保存的是第二次账号。
	oldGenerator := generateRegisterAccount
	oldCreateUser := createRegisterUser
	accounts := []string{"00123456", "00123457"}
	generateRegisterAccount = func() (string, error) {
		account := accounts[0]
		accounts = accounts[1:]
		return account, nil
	}
	createCalls := 0
	var created entity.User
	createRegisterUser = func(user *entity.User) error {
		createCalls++
		if createCalls == 1 {
			return mysqlrepo.ErrDuplicateAccount
		}
		created = *user
		return nil
	}
	t.Cleanup(func() {
		generateRegisterAccount = oldGenerator
		createRegisterUser = oldCreateUser
	})

	account, err := Register("张三", "secret")
	if err != nil {
		t.Fatalf("Register returned an error: %v", err)
	}
	if account != "00123457" || created.Account != "00123457" || createCalls != 2 {
		t.Fatalf("account = %q, created account = %q, create calls = %d, want 00123457 and 2 calls", account, created.Account, createCalls)
	}
}

func TestRegisterStopsAfterMaximumDuplicateAccountRetries(t *testing.T) {
	// 测试目标：验证连续账号唯一键冲突达到上限后，注册不会无限重试并返回稳定的服务错误。
	// 构造方法：注入固定账号生成器和始终返回重复错误的创建替身。
	// 输入数据：nickname=张三、password=secret，所有尝试都使用账号 00123456。
	// 预期行为：创建次数等于重试上限，返回 ErrRegistrationFailed，且不返回账号。
	oldGenerator := generateRegisterAccount
	oldCreateUser := createRegisterUser
	generateRegisterAccount = func() (string, error) { return "00123456", nil }
	createCalls := 0
	createRegisterUser = func(*entity.User) error {
		createCalls++
		return mysqlrepo.ErrDuplicateAccount
	}
	t.Cleanup(func() {
		generateRegisterAccount = oldGenerator
		createRegisterUser = oldCreateUser
	})

	account, err := Register("张三", "secret")
	if !errors.Is(err, ErrRegistrationFailed) {
		t.Fatalf("Register error = %v, want ErrRegistrationFailed", err)
	}
	if account != "" || createCalls != maxRegistrationAttempts {
		t.Fatalf("account = %q, create calls = %d, want empty account and %d calls", account, createCalls, maxRegistrationAttempts)
	}
}

func TestGenerateAccountReturnsEightToTwelveDigits(t *testing.T) {
	// 测试目标：验证生产账号生成器只产生长度 8 到 12 的纯数字账号。
	// 构造方法：调用真实 crypto/rand 账号生成器多次，检查每个结果的长度和字符集合。
	// 输入数据：20 次无固定值的随机账号生成请求。
	// 预期行为：每个账号长度都在范围内，且每个字符都是 ASCII 数字。
	for index := 0; index < 20; index++ {
		account, err := generateAccount()
		if err != nil {
			t.Fatalf("generateAccount returned an error: %v", err)
		}
		if len(account) < 8 || len(account) > 12 || strings.Trim(account, "0123456789") != "" {
			t.Fatalf("generated account = %q, want 8-12 digits", account)
		}
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
