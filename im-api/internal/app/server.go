package app

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	redisrepo "github.com/0Whisperos/whisper/im-server/internal/repository/redis"
	"github.com/0Whisperos/whisper/im-server/internal/router"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
)

func RunServer(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}
	if err := mysql.Open(cfg.Database); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := mysql.Close(); err != nil {
			logging.Error("close database after serve", "error", err)
		}
	}()
	if err := redisrepo.Open(cfg.Redis); err != nil {
		return fmt.Errorf("open Redis: %w", err)
	}
	defer func() {
		if err := redisrepo.Close(); err != nil {
			logging.Error("close Redis after serve", "error", err)
		}
	}()
	accessTokenTTL, err := cfg.Auth.AccessTokenDuration()
	if err != nil {
		return err
	}
	refreshTokenTTL, err := cfg.Auth.RefreshTokenDuration()
	if err != nil {
		return err
	}
	auth.SetTokenConfig([]byte(cfg.Auth.JWTSecret), accessTokenTTL, refreshTokenTTL)
	engine := router.New(cfg.CORS.AllowedOrigins)
	return engine.Run(cfg.Server.ListenAddr)
}
