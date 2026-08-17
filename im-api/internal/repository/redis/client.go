package redis

import (
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/global"
	goredis "github.com/redis/go-redis/v9"
)

var (
	ErrNotInitialized = errors.New("redis is not initialized")
	ErrAlreadyOpen    = errors.New("redis is already open")
)

func Open(config config.RedisConfig) error {
	if global.RedisClient != nil {
		return ErrAlreadyOpen
	}
	dialTimeout, err := config.DialTimeoutDuration()
	if err != nil {
		return err
	}
	readTimeout, err := config.ReadTimeoutDuration()
	if err != nil {
		return err
	}
	writeTimeout, err := config.WriteTimeoutDuration()
	if err != nil {
		return err
	}
	poolTimeout, err := config.Pool.PoolTimeoutDuration()
	if err != nil {
		return err
	}
	connMaxIdleTime, err := config.Pool.ConnMaxIdleTimeDuration()
	if err != nil {
		return err
	}
	connMaxLifetime, err := config.Pool.ConnMaxLifetimeDuration()
	if err != nil {
		return err
	}
	global.RedisClient = goredis.NewClient(&goredis.Options{
		Addr:            fmt.Sprintf("%s:%d", config.Host, config.Port),
		Username:        config.Username,
		Password:        config.Password,
		DB:              config.DB,
		DialTimeout:     dialTimeout,
		ReadTimeout:     readTimeout,
		WriteTimeout:    writeTimeout,
		PoolSize:        config.Pool.PoolSize,
		MinIdleConns:    config.Pool.MinIdleConns,
		MaxIdleConns:    config.Pool.MaxIdleConns,
		MaxActiveConns:  config.Pool.MaxActiveConns,
		PoolTimeout:     poolTimeout,
		ConnMaxIdleTime: connMaxIdleTime,
		ConnMaxLifetime: connMaxLifetime,
	})
	return nil
}

func Close() error {
	if global.RedisClient == nil {
		return nil
	}
	client := global.RedisClient
	global.RedisClient = nil
	return client.Close()
}
