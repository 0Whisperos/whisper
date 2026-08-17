package redis

import goredis "github.com/redis/go-redis/v9"

type Config struct {
	Addr     string
	Username string
	Password string
}

func Open(config Config) *goredis.Client {
	return goredis.NewClient(&goredis.Options{
		Addr:     config.Addr,
		Username: config.Username,
		Password: config.Password,
	})
}
