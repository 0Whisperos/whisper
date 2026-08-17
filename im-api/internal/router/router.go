package router

import (
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/handler"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

type Config struct {
	AllowedOrigins []string
	Login          handler.LoginFunc
	Refresh        handler.RefreshFunc
	Logout         handler.LogoutFunc
}

func New(config Config) *gin.Engine {
	engine := gin.Default()
	if len(config.AllowedOrigins) > 0 {
		engine.Use(cors.New(cors.Config{
			AllowOrigins: config.AllowedOrigins,
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
	v1 := engine.Group("/v1")
	authRoutes := v1.Group("/auth")
	{
		authRoutes.POST("/login", handler.LoginHandler(config.Login))
		authRoutes.POST("/refresh", handler.RefreshHandler(config.Refresh))
		authRoutes.POST("/logout", handler.LogoutHandler(config.Logout))
	}
	return engine
}
