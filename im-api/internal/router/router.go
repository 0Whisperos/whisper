package router

import (
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func New(allowedOrigins []string) *gin.Engine {
	engine := gin.Default()
	if len(allowedOrigins) > 0 {
		engine.Use(cors.New(cors.Config{
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
	v1 := engine.Group("/v1")
	registerAuthRoutes(v1)
	return engine
}
