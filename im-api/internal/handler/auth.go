package handler

import (
	"errors"
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func LoginHandler(login LoginFunc) gin.HandlerFunc {
	return func(context *gin.Context) {
		var request loginRequest
		if err := context.ShouldBindJSON(&request); err != nil {
			writeAuthError(context, auth.ErrInvalidRequest)
			return
		}
		result, err := login(context.Request.Context(), request.Account, request.Password)
		if writeAuthError(context, err) {
			return
		}
		context.JSON(http.StatusOK, loginResponse{
			AccessToken:          result.AccessToken,
			RefreshToken:         result.RefreshToken,
			AccessTokenExpiresAt: formatProtocolTime(result.AccessTokenExpiresAt),
			IMChatWSURL:          result.IMChatWSURL,
		})
	}
}

func RefreshHandler(refresh RefreshFunc) gin.HandlerFunc {
	return func(context *gin.Context) {
		var request refreshRequest
		if err := context.ShouldBindJSON(&request); err != nil {
			writeAuthError(context, auth.ErrInvalidRequest)
			return
		}
		result, err := refresh(context.Request.Context(), request.RefreshToken)
		if writeAuthError(context, err) {
			return
		}
		context.JSON(http.StatusOK, refreshResponse{
			AccessToken:          result.AccessToken,
			AccessTokenExpiresAt: formatProtocolTime(result.AccessTokenExpiresAt),
			IMChatWSURL:          result.IMChatWSURL,
		})
	}
}

func LogoutHandler(logout LogoutFunc) gin.HandlerFunc {
	return func(context *gin.Context) {
		var request logoutRequest
		if err := context.ShouldBindJSON(&request); err != nil {
			writeAuthError(context, auth.ErrInvalidRequest)
			return
		}
		if err := logout(context.Request.Context(), request.RefreshToken); err != nil {
			if errors.Is(err, auth.ErrInvalidRequest) {
				writeAuthError(context, auth.ErrInvalidRequest)
				return
			}
			logging.Error("logout failed", "error", err)
			context.JSON(http.StatusInternalServerError, errorResponse{
				ErrorCode: "internal_error",
				Message:   "internal error",
			})
			return
		}
		context.Status(http.StatusNoContent)
	}
}

func writeAuthError(context *gin.Context, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, auth.ErrInvalidRequest):
		context.JSON(http.StatusBadRequest, errorResponse{ErrorCode: "invalid_request", Message: "invalid request"})
		return true
	case errors.Is(err, auth.ErrInvalidCredentials):
		context.JSON(http.StatusUnauthorized, errorResponse{ErrorCode: "invalid_credentials", Message: "account or password is incorrect"})
		return true
	case errors.Is(err, auth.ErrInvalidRefreshToken):
		context.JSON(http.StatusUnauthorized, errorResponse{ErrorCode: "invalid_refresh_token", Message: "invalid refresh token"})
		return true
	case errors.Is(err, auth.ErrNoAvailableChatNode):
		context.JSON(http.StatusServiceUnavailable, errorResponse{ErrorCode: "no_available_chat_node", Message: "no available chat node"})
		return true
	default:
		logging.Error("auth request failed", "error", err)
		context.JSON(http.StatusInternalServerError, errorResponse{ErrorCode: "internal_error", Message: "internal error"})
		return true
	}
}
