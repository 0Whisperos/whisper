package router

import (
	"github.com/0Whisperos/whisper/im-server/internal/handler"
	"github.com/gin-gonic/gin"
)

func registerAuthRoutes(group *gin.RouterGroup) {
	authRoutes := group.Group("/auth")
	authRoutes.POST("/login", handler.Login)
	authRoutes.POST("/refresh", handler.Refresh)
	authRoutes.POST("/logout", handler.Logout)
}
