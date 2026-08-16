package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConfigFile(t *testing.T, contents string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write temporary config file: %v", err)
	}

	return path
}

func validConfig() Config {
	return Config{
		Server:   ServerConfig{ListenAddr: "127.0.0.1:8080"},
		Database: DatabaseConfig{DSN: "root:password@tcp(127.0.0.1:3306)/whisper"},
		Redis:    RedisConfig{Addr: "127.0.0.1:6379", Username: "whisper", Password: "root"},
		CORS:     CORSConfig{AllowedOrigins: []string{"http://127.0.0.1:1420"}},
		Seed:     SeedConfig{Account: "00123456", Password: "development-password"},
	}
}

func TestLoadParsesCompleteConfiguration(t *testing.T) {
	// 测试目标：验证 Load 能将完整 YAML 配置映射为嵌套 Config 结构。
	// 构造方法：在临时目录创建包含服务、数据库、CORS 和种子字段的 YAML 文件，再调用 Load。
	// 输入数据：监听地址、MySQL DSN、一个 CORS 来源和 8 位种子账号。
	// 预期行为：Load 不返回错误，且解析字段与 YAML 配置一致。
	path := writeConfigFile(t, `
server:
  listen_addr: 127.0.0.1:8080
database:
  dsn: root:password@tcp(127.0.0.1:3306)/whisper
redis:
  addr: 127.0.0.1:6379
  username: whisper
  password: root
cors:
  allowed_origins:
    - http://127.0.0.1:1420
seed:
  account: "00123456"
  password: development-password
`)

	config, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned an error: %v", err)
	}
	if config.Server.ListenAddr != "127.0.0.1:8080" || config.Database.DSN != "root:password@tcp(127.0.0.1:3306)/whisper" {
		t.Errorf("Load returned unexpected server or database config: %#v", config)
	}
	if len(config.CORS.AllowedOrigins) != 1 || config.CORS.AllowedOrigins[0] != "http://127.0.0.1:1420" {
		t.Errorf("AllowedOrigins = %#v, want [http://127.0.0.1:1420]", config.CORS.AllowedOrigins)
	}
	if config.Redis.Addr != "127.0.0.1:6379" || config.Redis.Username != "whisper" || config.Redis.Password != "root" {
		t.Errorf("Redis = %#v, want configured addr, username and password", config.Redis)
	}
	if config.Seed.Account != "00123456" || config.Seed.Password != "development-password" {
		t.Errorf("Seed = %#v, want the configured account and password", config.Seed)
	}
}

func TestLoadRejectsMissingAndMalformedFiles(t *testing.T) {
	// 测试目标：验证 Load 对不存在文件和无效 YAML 都返回错误。
	// 构造方法：分别提供未创建的临时文件路径和包含未闭合 YAML 列表的临时文件。
	// 输入数据：不存在的 config.yaml 路径，以及内容为 "server: [" 的 YAML。
	// 预期行为：两个输入都返回非空错误。
	if _, err := Load(filepath.Join(t.TempDir(), "config.yaml")); err == nil {
		t.Error("Load returned nil error for a missing configuration file")
	}
	if _, err := Load(writeConfigFile(t, "server: [")); err == nil {
		t.Error("Load returned nil error for malformed YAML")
	}
}

func TestValidateServerRejectsMissingRequiredValues(t *testing.T) {
	// 测试目标：验证启动服务所需的监听地址、数据库 DSN、Redis 地址和 CORS 来源均不能为空。
	// 构造方法：从完整有效配置复制五个场景，并在每个场景中移除一个必需值。
	// 输入数据：空监听地址、空 DSN、空 Redis 地址、空 CORS 列表和包含空字符串的 CORS 列表。
	// 预期行为：每个场景的 ValidateServer 都返回非空错误。
	config := validConfig()
	config.Server.ListenAddr = ""
	if err := config.ValidateServer(); err == nil {
		t.Error("ValidateServer returned nil error for an empty listen address")
	}

	config = validConfig()
	config.Database.DSN = ""
	if err := config.ValidateServer(); err == nil {
		t.Error("ValidateServer returned nil error for an empty database DSN")
	}

	config = validConfig()
	config.Redis.Addr = ""
	if err := config.ValidateServer(); err == nil {
		t.Error("ValidateServer returned nil error for an empty Redis address")
	}

	config = validConfig()
	config.CORS.AllowedOrigins = nil
	if err := config.ValidateServer(); err == nil {
		t.Error("ValidateServer returned nil error for empty CORS origins")
	}

	config = validConfig()
	config.CORS.AllowedOrigins = []string{""}
	if err := config.ValidateServer(); err == nil {
		t.Error("ValidateServer returned nil error for a blank CORS origin")
	}
}

func TestValidateSeedEnforcesAccountAndPasswordRules(t *testing.T) {
	// 测试目标：验证 8-12 位纯数字账号和非空密码是种子配置的必要条件。
	// 构造方法：从完整有效配置复制多个场景，并替换账号长度、账号内容或密码。
	// 输入数据：8 位账号、12 位账号、7 位账号、13 位账号、字母账号和空密码。
	// 预期行为：边界长度的数字账号通过，其他无效场景均返回非空错误。
	config := validConfig()
	if err := config.ValidateSeed(); err != nil {
		t.Fatalf("ValidateSeed returned an error for an 8 digit account: %v", err)
	}

	config = validConfig()
	config.Seed.Account = "001234567890"
	if err := config.ValidateSeed(); err != nil {
		t.Errorf("ValidateSeed returned an error for a 12 digit account: %v", err)
	}

	for _, account := range []string{"0123456", "0012345678901", "abcdefgh"} {
		config = validConfig()
		config.Seed.Account = account
		if err := config.ValidateSeed(); err == nil {
			t.Errorf("ValidateSeed returned nil error for invalid account %q", account)
		}
	}

	config = validConfig()
	config.Seed.Password = ""
	if err := config.ValidateSeed(); err == nil {
		t.Error("ValidateSeed returned nil error for an empty password")
	}
}
