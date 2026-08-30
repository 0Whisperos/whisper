package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

const userIDContextKey = "authenticated_user_id"

func RequireAccessToken() gin.HandlerFunc {
	return func(context *gin.Context) {
		accessToken, ok := bearerToken(context.GetHeader("Authorization"))
		if !ok {
			writeAuthError(context, http.StatusUnauthorized, "invalid_token", "invalid access token")
			return
		}

		claims, err := auth.VerifyAccessToken(accessToken)
		if errors.Is(err, auth.ErrAccessTokenExpired) {
			writeAuthError(context, http.StatusUnauthorized, "token_expired", "access token expired")
			return
		}
		if err != nil {
			writeAuthError(context, http.StatusUnauthorized, "invalid_token", "invalid access token")
			return
		}

		context.Set(userIDContextKey, claims.UserID)
		context.Next()
	}
}

func UserID(context *gin.Context) (uint64, bool) {
	value, exists := context.Get(userIDContextKey)
	if !exists {
		return 0, false
	}
	userID, ok := value.(uint64)
	return userID, ok
}

func bearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func writeAuthError(context *gin.Context, statusCode int, errorCode, message string) {
	context.AbortWithStatusJSON(statusCode, response.Error{ErrorCode: errorCode, Message: message})
}
