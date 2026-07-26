package serve

import (
	"fmt"
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/database"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func Run(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}
	if err := database.Open(cfg.Database.DSN); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := database.Close(); err != nil {
			logging.Error("close database after serve", "error", err)
		}
	}()
	router := NewRouter(cfg.CORS.AllowedOrigins)
	return router.Run(cfg.Server.ListenAddr)
}

func NewRouter(allowedOrigins []string) *gin.Engine {
	router := gin.Default()
	if len(allowedOrigins) > 0 {
		router.Use(cors.New(cors.Config{
			AllowOrigins: allowedOrigins,
			AllowMethods: []string{
				http.MethodPost,
				http.MethodOptions,
			},
			AllowHeaders: []string{
				"Content-Type",
				"Authorization",
			},
		}))
	}
	v1 := router.Group("/v1")
	authRoutes := v1.Group("/auth")
	{
		authRoutes.POST("/login", loginHandler)
		authRoutes.POST("/logout", logoutHandler)
	}
	return router
}
