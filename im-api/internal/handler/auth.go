package handler

import (
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/model/request"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func Login(context *gin.Context) {
	var payload request.Login
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, auth.ErrInvalidRequest, authErrorMappings...)
		return
	}
	result, err := auth.Login(payload.Account, payload.Password)
	if writeError(context, err, authErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, response.NewLogin(
		result.UserID,
		result.AccessToken,
		result.RefreshToken,
		result.AccessTokenExpiresAt,
		result.IMChatWSURL,
	))
}

func Refresh(context *gin.Context) {
	var payload request.Refresh
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, auth.ErrInvalidRequest, authErrorMappings...)
		return
	}
	result, err := auth.Refresh(payload.RefreshToken)
	if writeError(context, err, authErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, response.NewRefresh(
		result.UserID,
		result.AccessToken,
		result.AccessTokenExpiresAt,
		result.IMChatWSURL,
	))
}

func Logout(context *gin.Context) {
	var payload request.Logout
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, auth.ErrInvalidRequest, authErrorMappings...)
		return
	}
	if writeError(context, auth.Logout(payload.RefreshToken), authErrorMappings...) {
		return
	}
	context.Status(http.StatusNoContent)
}

var authErrorMappings = []errorMapping{
	{Err: auth.ErrInvalidRequest, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_request", Message: "invalid request"},
	{Err: auth.ErrInvalidCredentials, StatusCode: http.StatusUnauthorized, ErrorCode: "invalid_credentials", Message: "account or password is incorrect"},
	{Err: auth.ErrInvalidRefreshToken, StatusCode: http.StatusUnauthorized, ErrorCode: "invalid_refresh_token", Message: "invalid refresh token"},
	{Err: auth.ErrNoAvailableChatNode, StatusCode: http.StatusServiceUnavailable, ErrorCode: "no_available_chat_node", Message: "no available chat node"},
}
