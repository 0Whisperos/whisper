package serve

import (
	"errors"
	"github.com/0Whisperos/whisper/im-server/internal/auth"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

func loginHandler(context *gin.Context) {
	var request loginRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		writeLoginError(context, auth.ErrInvalidRequest)
		return
	}
	result, err := auth.Login(request.Account, request.Password)
	if writeLoginError(context, err) {
		return
	}
	context.JSON(http.StatusOK, loginResponse{
		AccessToken: result.AccessToken,
		Account:     result.Account,
		ExpiresAt:   result.ExpiresAt,
	})
}

func writeLoginError(context *gin.Context, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, auth.ErrInvalidRequest):
		context.JSON(http.StatusBadRequest, errorResponse{
			Error: "invalid_request",
		})
		return true
	case errors.Is(err, auth.ErrInvalidCredentials):
		context.JSON(http.StatusUnauthorized, errorResponse{
			Error: "invalid_credentials",
		})
		return true
	default:
		logging.Error("login failed", "error", err)
		context.JSON(http.StatusInternalServerError,
			errorResponse{
				Error: "internal_error",
			})
		return true
	}
}

func logoutHandler(context *gin.Context) {
	token, found := extractBearerToken(context.GetHeader("Authorization"))
	if !found {
		context.Status(http.StatusNoContent)
		return
	}
	if err := auth.Logout(token); err != nil {
		logging.Error("logout failed", "error", err)
		context.JSON(http.StatusInternalServerError, errorResponse{
			Error: "internal_error",
		})
		return
	}
	context.Status(http.StatusNoContent)
}

func extractBearerToken(authorization string) (string, bool) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 {
		return "", false
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return "", false
	}
	if parts[1] == "" {
		return "", false
	}
	return parts[1], true
}
