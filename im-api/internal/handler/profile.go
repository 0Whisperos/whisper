package handler

import (
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/0Whisperos/whisper/im-server/internal/model/request"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	"github.com/0Whisperos/whisper/im-server/internal/service/profile"
	"github.com/gin-gonic/gin"
)

func AuthorizeAvatarUpload(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		writeProfileUnauthorized(context)
		return
	}
	var payload request.AvatarUploadAuthorization
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, profile.ErrInvalidAvatar, profileErrorMappings...)
		return
	}
	authorization, err := profile.AuthorizeAvatarUpload(context.Request.Context(), userID, payload.ContentType)
	if writeError(context, err, profileErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, response.AvatarUploadAuthorization{
		ObjectKey: authorization.ObjectKey,
		UploadURL: authorization.URL,
		Method:    authorization.Method,
		Headers:   authorization.Headers,
		ExpiresAt: authorization.ExpiresAt,
	})
}

func AuthorizeAvatarDownload(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		writeProfileUnauthorized(context)
		return
	}
	authorization, err := profile.AuthorizeAvatarDownload(context.Request.Context(), userID)
	if writeError(context, err, profileErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, response.AvatarDownloadAuthorization{
		ObjectKey:   authorization.ObjectKey,
		DownloadURL: authorization.URL,
		ExpiresAt:   authorization.ExpiresAt,
	})
}

func UpdateProfile(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		writeProfileUnauthorized(context)
		return
	}
	var payload request.UpdateProfile
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, profile.ErrInvalidProfile, profileErrorMappings...)
		return
	}
	user, err := profile.UpdateProfile(
		context.Request.Context(),
		userID,
		payload.Nickname,
		payload.Signature,
		payload.AvatarObjectKey.Present,
		payload.AvatarObjectKey.Value,
	)
	if writeError(context, err, profileErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, profileResponse(user))
}

func writeProfileUnauthorized(context *gin.Context) {
	context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
}

var profileErrorMappings = []errorMapping{
	{Err: profile.ErrInvalidProfile, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_profile", Message: "nickname or signature is invalid"},
	{Err: profile.ErrInvalidAvatar, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_avatar", Message: "avatar content type must be image/png"},
	{Err: profile.ErrAvatarTooLarge, StatusCode: http.StatusBadRequest, ErrorCode: "avatar_too_large", Message: "avatar must not exceed 5 MiB"},
	{Err: profile.ErrUnsupportedAvatar, StatusCode: http.StatusBadRequest, ErrorCode: "unsupported_avatar", Message: "avatar content is not a supported image"},
	{Err: profile.ErrAvatarKeyForbidden, StatusCode: http.StatusForbidden, ErrorCode: "avatar_key_forbidden", Message: "avatar does not belong to the current user"},
	{Err: profile.ErrAvatarNotFound, StatusCode: http.StatusNotFound, ErrorCode: "avatar_not_found", Message: "avatar not found"},
	{Err: profile.ErrUserNotFound, StatusCode: http.StatusNotFound, ErrorCode: "user_not_found", Message: "user not found"},
}
