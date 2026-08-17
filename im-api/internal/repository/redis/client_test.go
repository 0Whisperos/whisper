package redis

import (
	"errors"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/global"
)

func TestOpenBuildsClientFromStructuredRedisConfig(t *testing.T) {
	// 测试目标：验证 Redis Open 从结构化配置创建全局 Redis client。
	// 构造方法：清空 global.RedisClient，调用 Open，再读取 go-redis Options。
	// 输入数据：host、port、username、password、db、timeout 和连接池配置。
	// 预期行为：global.RedisClient 不为空，Options 字段与结构化配置一致，不要求用户手写 addr。
	oldClient := global.RedisClient
	global.RedisClient = nil
	t.Cleanup(func() {
		if global.RedisClient != nil {
			if err := global.RedisClient.Close(); err != nil {
				t.Fatalf("close Redis client: %v", err)
			}
		}
		global.RedisClient = oldClient
	})

	err := Open(config.RedisConfig{
		Host:         "127.0.0.1",
		Port:         6379,
		Username:     "whisper",
		Password:     "root",
		DB:           2,
		DialTimeout:  "5s",
		ReadTimeout:  "3s",
		WriteTimeout: "4s",
		Pool: config.RedisPoolConfig{
			PoolSize:        20,
			MinIdleConns:    2,
			MaxIdleConns:    10,
			MaxActiveConns:  30,
			PoolTimeout:     "6s",
			ConnMaxIdleTime: "30m",
			ConnMaxLifetime: "1h",
		},
	})
	if err != nil {
		t.Fatalf("Open returned an error: %v", err)
	}
	if global.RedisClient == nil {
		t.Fatal("global.RedisClient is nil")
	}

	options := global.RedisClient.Options()
	if options.Addr != "127.0.0.1:6379" {
		t.Fatalf("Addr = %q, want 127.0.0.1:6379", options.Addr)
	}
	if options.Username != "whisper" || options.Password != "root" || options.DB != 2 {
		t.Fatalf("auth/db options = %q, %q, %d; want whisper, root, 2", options.Username, options.Password, options.DB)
	}
	if options.DialTimeout != 5*time.Second || options.ReadTimeout != 3*time.Second || options.WriteTimeout != 4*time.Second {
		t.Fatalf("timeouts = %v, %v, %v; want 5s, 3s, 4s", options.DialTimeout, options.ReadTimeout, options.WriteTimeout)
	}
	if options.PoolSize != 20 || options.MinIdleConns != 2 || options.MaxIdleConns != 10 || options.MaxActiveConns != 30 {
		t.Fatalf("pool sizes = %d, %d, %d, %d; want 20, 2, 10, 30", options.PoolSize, options.MinIdleConns, options.MaxIdleConns, options.MaxActiveConns)
	}
	if options.PoolTimeout != 6*time.Second || options.ConnMaxIdleTime != 30*time.Minute || options.ConnMaxLifetime != time.Hour {
		t.Fatalf("pool durations = %v, %v, %v; want 6s, 30m, 1h", options.PoolTimeout, options.ConnMaxIdleTime, options.ConnMaxLifetime)
	}
}

func TestOpenRejectsAlreadyInitializedRedisClient(t *testing.T) {
	// 测试目标：验证 Redis client 已初始化时 Open 返回稳定错误。
	// 构造方法：先通过 Open 创建 global.RedisClient，再第二次调用 Open。
	// 输入数据：两次都使用同一份有效 RedisConfig。
	// 预期行为：第二次 Open 返回可通过 errors.Is 判定的 ErrAlreadyOpen。
	oldClient := global.RedisClient
	global.RedisClient = nil
	t.Cleanup(func() {
		if global.RedisClient != nil {
			if err := global.RedisClient.Close(); err != nil {
				t.Fatalf("close Redis client: %v", err)
			}
		}
		global.RedisClient = oldClient
	})

	config := config.RedisConfig{
		Host:         "127.0.0.1",
		Port:         6379,
		DialTimeout:  "5s",
		ReadTimeout:  "3s",
		WriteTimeout: "4s",
		Pool: config.RedisPoolConfig{
			PoolTimeout: "6s",
		},
	}
	if err := Open(config); err != nil {
		t.Fatalf("first Open returned an error: %v", err)
	}

	err := Open(config)

	if !errors.Is(err, ErrAlreadyOpen) {
		t.Fatalf("second Open error = %v, want ErrAlreadyOpen", err)
	}
}
