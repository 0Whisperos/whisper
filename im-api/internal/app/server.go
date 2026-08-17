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
	if err := mysql.Open(cfg.Database.DSN); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := mysql.Close(); err != nil {
			logging.Error("close database after serve", "error", err)
		}
	}()
	redisClient := redisrepo.Open(redisrepo.Config{
		Addr:     cfg.Redis.Addr,
		Username: cfg.Redis.Username,
		Password: cfg.Redis.Password,
	})
	defer func() {
		if err := redisClient.Close(); err != nil {
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
	refreshRepository := redisrepo.NewRefreshTokenRepository(redisClient)
	chatNodeRepository := redisrepo.NewChatNodeRepository(redisClient)
	authService := auth.NewService(auth.ServiceConfig{
		FindUserByAccount:          mysql.FindUserByAccountContext,
		SaveRefreshToken:           refreshRepository.Save,
		FindRefreshToken:           refreshRepository.Find,
		UpdateRefreshTokenLastUsed: refreshRepository.UpdateLastUsedAt,
		DeleteRefreshToken:         refreshRepository.Delete,
		SelectReadyChatNode:        chatNodeRepository.SelectReady,
		JWTSecret:                  []byte(cfg.Auth.JWTSecret),
		AccessTokenTTL:             accessTokenTTL,
		RefreshTokenTTL:            refreshTokenTTL,
	})
	engine := router.New(router.Config{
		AllowedOrigins: cfg.CORS.AllowedOrigins,
		Login:          authService.Login,
		Refresh:        authService.Refresh,
		Logout:         authService.Logout,
	})
	return engine.Run(cfg.Server.ListenAddr)
}
