package handler

import (
	"net/http"
	"strconv"

	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	attachmentservice "github.com/0Whisperos/whisper/im-server/internal/service/attachments"
	"github.com/gin-gonic/gin"
)

func AuthorizeAttachmentUploads(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}
	var request attachmentservice.UploadRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		writeError(context, attachmentservice.ErrInvalidRequest, attachmentErrorMappings...)
		return
	}
	attachments, err := attachmentservice.AuthorizeUploads(context.Request.Context(), userID, request)
	if writeError(context, err, attachmentErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, gin.H{"attachments": attachments})
}

func CompleteAttachmentUploads(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}
	var request attachmentservice.CompletionRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		writeError(context, attachmentservice.ErrInvalidRequest, attachmentErrorMappings...)
		return
	}
	attachments, err := attachmentservice.ConfirmUploads(context.Request.Context(), userID, request)
	if writeError(context, err, attachmentErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, gin.H{"attachments": attachments})
}

func AuthorizeAttachmentDownloads(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}
	conversationID, err := strconv.ParseUint(context.Param("conversation_id"), 10, 64)
	if err != nil || conversationID == 0 {
		writeError(context, attachmentservice.ErrInvalidRequest, attachmentErrorMappings...)
		return
	}
	var request attachmentservice.CompletionRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		writeError(context, attachmentservice.ErrInvalidRequest, attachmentErrorMappings...)
		return
	}
	attachments, err := attachmentservice.AuthorizeDownloads(context.Request.Context(), userID, conversationID, request)
	if writeError(context, err, attachmentErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, gin.H{"attachments": attachments})
}

var attachmentErrorMappings = []errorMapping{
	{Err: attachmentservice.ErrInvalidRequest, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_attachment_request", Message: "invalid attachment request"},
	{Err: attachmentservice.ErrUnsupportedImageType, StatusCode: http.StatusBadRequest, ErrorCode: "unsupported_image_type", Message: "content_type must be image/jpeg, image/png, or image/webp"},
	{Err: attachmentservice.ErrAttachmentTooLarge, StatusCode: http.StatusRequestEntityTooLarge, ErrorCode: "attachment_too_large", Message: "attachment is too large"},
	{Err: attachmentservice.ErrConversationNotFound, StatusCode: http.StatusNotFound, ErrorCode: "conversation_not_found", Message: "conversation not found"},
	{Err: attachmentservice.ErrNotConversationMember, StatusCode: http.StatusForbidden, ErrorCode: "not_conversation_member", Message: "not a conversation member"},
	{Err: attachmentservice.ErrAttachmentUnavailable, StatusCode: http.StatusNotFound, ErrorCode: "attachment_unavailable", Message: "attachment unavailable"},
	{Err: attachmentservice.ErrStorageNotConfigured, StatusCode: http.StatusInternalServerError, ErrorCode: "internal_error", Message: "internal error"},
}
