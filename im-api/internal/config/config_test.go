package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
		Server: ServerConfig{ListenAddr: "127.0.0.1:8080"},
		Database: DatabaseConfig{
			Host:         "127.0.0.1",
			Port:         3306,
			Username:     "whisper",
			Password:     "root",
			Name:         "whisper",
			Charset:      "utf8mb4",
			ParseTime:    true,
			Loc:          "Local",
			Timeout:      "5s",
			ReadTimeout:  "5s",
			WriteTimeout: "5s",
			Pool: DatabasePoolConfig{
				MaxOpenConns:    50,
				MaxIdleConns:    10,
				ConnMaxLifetime: "1h",
				ConnMaxIdleTime: "30m",
			},
		},
		Redis: RedisConfig{
			Host:         "127.0.0.1",
			Port:         6379,
			Username:     "whisper",
			Password:     "root",
			DB:           0,
			DialTimeout:  "5s",
			ReadTimeout:  "3s",
			WriteTimeout: "3s",
			Pool: RedisPoolConfig{
				PoolSize:        20,
				MinIdleConns:    2,
				MaxIdleConns:    10,
				MaxActiveConns:  0,
				PoolTimeout:     "4s",
				ConnMaxIdleTime: "30m",
				ConnMaxLifetime: "0s",
			},
		},
		Auth: AuthConfig{
			JWTSecret:       "development-secret",
			AccessTokenTTL:  "15m",
			RefreshTokenTTL: "720h",
		},
		CORS: CORSConfig{AllowedOrigins: []string{"http://127.0.0.1:1420"}},
		Seed: SeedConfig{Account: "00123456", Password: "development-password"},
	}
}

func TestLoadParsesCompleteConfiguration(t *testing.T) {
	// 测试目标：验证 Load 能将结构化数据库、Redis、连接池和业务配置映射为 Config 结构。
	// 构造方法：在临时目录创建完整 YAML 文件，再调用 Load。
	// 输入数据：MySQL host/port/name/pool、Redis host/port/db/pool、JWT、CORS 和 seed 字段。
	// 预期行为：Load 不返回错误，且解析字段与 YAML 配置一致。
	path := writeConfigFile(t, `
server:
  listen_addr: 127.0.0.1:8080
database:
  host: 127.0.0.1
  port: 3306
  username: whisper
  password: root
  name: whisper
  charset: utf8mb4
  parse_time: true
  loc: Local
  timeout: 5s
  read_timeout: 5s
  write_timeout: 5s
  pool:
    max_open_conns: 50
    max_idle_conns: 10
    conn_max_lifetime: 1h
    conn_max_idle_time: 30m
redis:
  host: 127.0.0.1
  port: 6379
  username: whisper
  password: root
  db: 1
  dial_timeout: 5s
  read_timeout: 3s
  write_timeout: 3s
  pool:
    pool_size: 20
    min_idle_conns: 2
    max_idle_conns: 10
    max_active_conns: 0
    pool_timeout: 4s
    conn_max_idle_time: 30m
    conn_max_lifetime: 0s
auth:
  jwt_secret: development-secret
  access_token_ttl: 15m
  refresh_token_ttl: 720h
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
	if config.Database.Host != "127.0.0.1" || config.Database.Port != 3306 || config.Database.Name != "whisper" {
		t.Errorf("Database = %#v, want configured host, port and name", config.Database)
	}
	if config.Database.Pool.MaxOpenConns != 50 || config.Database.Pool.ConnMaxIdleTime != "30m" {
		t.Errorf("Database.Pool = %#v, want configured pool settings", config.Database.Pool)
	}
	if config.Redis.Host != "127.0.0.1" || config.Redis.Port != 6379 || config.Redis.DB != 1 {
		t.Errorf("Redis = %#v, want configured host, port and db", config.Redis)
	}
	if config.Redis.Pool.PoolSize != 20 || config.Redis.Pool.ConnMaxLifetime != "0s" {
		t.Errorf("Redis.Pool = %#v, want configured pool settings", config.Redis.Pool)
	}
	if config.Auth.JWTSecret != "development-secret" || config.Auth.AccessTokenTTL != "15m" || config.Auth.RefreshTokenTTL != "720h" {
		t.Errorf("Auth = %#v, want configured JWT secret and TTLs", config.Auth)
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
	// 测试目标：验证启动服务所需的地址、数据库、Redis、JWT 和 CORS 配置不能为空或非法。
	// 构造方法：从完整有效配置复制多个场景，并在每个场景中修改一个必需值。
	// 输入数据：空监听地址、空数据库 host、非法数据库端口、空库名、空 Redis host、非法 Redis 端口、非法 Redis db、空 JWT secret 和空 CORS。
	// 预期行为：每个场景的 ValidateServer 都返回非空错误。
	testCases := []struct {
		name   string
		change func(*Config)
	}{
		{name: "empty listen address", change: func(config *Config) { config.Server.ListenAddr = "" }},
		{name: "empty database host", change: func(config *Config) { config.Database.Host = "" }},
		{name: "invalid database port", change: func(config *Config) { config.Database.Port = 0 }},
		{name: "empty database name", change: func(config *Config) { config.Database.Name = "" }},
		{name: "empty redis host", change: func(config *Config) { config.Redis.Host = "" }},
		{name: "invalid redis port", change: func(config *Config) { config.Redis.Port = 70000 }},
		{name: "invalid redis db", change: func(config *Config) { config.Redis.DB = -1 }},
		{name: "empty jwt secret", change: func(config *Config) { config.Auth.JWTSecret = "" }},
		{name: "empty cors origins", change: func(config *Config) { config.CORS.AllowedOrigins = nil }},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			// 测试目标：验证当前非法配置场景会被 ValidateServer 拒绝。
			// 构造方法：基于 validConfig 修改一个字段。
			// 输入数据：当前子测试指定的非法字段值。
			// 预期行为：ValidateServer 返回非空错误。
			config := validConfig()
			testCase.change(&config)
			if err := config.ValidateServer(); err == nil {
				t.Fatal("ValidateServer returned nil error")
			}
		})
	}
}

func TestDurationHelpersParsePoolSettings(t *testing.T) {
	// 测试目标：验证数据库和 Redis 连接池 duration 字段能被解析为 time.Duration。
	// 构造方法：使用 validConfig 创建配置，并调用连接池 duration helper。
	// 输入数据：database conn_max_lifetime=1h、conn_max_idle_time=30m，redis pool_timeout=4s。
	// 预期行为：解析结果分别等于 1h、30m 和 4s。
	config := validConfig()

	lifetime, err := config.Database.Pool.ConnMaxLifetimeDuration()
	if err != nil {
		t.Fatalf("ConnMaxLifetimeDuration returned an error: %v", err)
	}
	idleTime, err := config.Database.Pool.ConnMaxIdleTimeDuration()
	if err != nil {
		t.Fatalf("ConnMaxIdleTimeDuration returned an error: %v", err)
	}
	poolTimeout, err := config.Redis.Pool.PoolTimeoutDuration()
	if err != nil {
		t.Fatalf("PoolTimeoutDuration returned an error: %v", err)
	}

	if lifetime != time.Hour || idleTime != 30*time.Minute || poolTimeout != 4*time.Second {
		t.Fatalf("durations = %v, %v, %v; want 1h, 30m, 4s", lifetime, idleTime, poolTimeout)
	}
}
