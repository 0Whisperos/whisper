package router

import (
	"github.com/0Whisperos/whisper/im-server/internal/handler"
	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/gin-gonic/gin"
)

func registerChatRoutes(group *gin.RouterGroup) {
	chatRoutes := group.Group("", middleware.RequireAccessToken())
	chatRoutes.GET("/me", handler.Me)
	chatRoutes.GET("/friends", handler.Friends)
	chatRoutes.GET("/conversations/:conversation_id/messages", handler.ConversationMessages)
}
