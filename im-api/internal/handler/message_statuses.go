package handler

import (
	"net/http"
	"strconv"

	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/0Whisperos/whisper/im-server/internal/model/request"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	chatservice "github.com/0Whisperos/whisper/im-server/internal/service/chat"
	"github.com/gin-gonic/gin"
)

var listConversationMessageStatuses = chatservice.ListConversationMessageStatuses

func ConversationMessageStatuses(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}
	conversationID, err := strconv.ParseUint(context.Param("conversation_id"), 10, 64)
	if err != nil || conversationID == 0 {
		writeError(context, chatservice.ErrInvalidMessageStatusRequest, chatErrorMappings...)
		return
	}
	var payload request.MessageStatuses
	if err := context.ShouldBindJSON(&payload); err != nil {
		writeError(context, chatservice.ErrInvalidMessageStatusRequest, chatErrorMappings...)
		return
	}
	statuses, err := listConversationMessageStatuses(userID, conversationID, payload.MessageIDs)
	if writeError(context, err, chatErrorMappings...) {
		return
	}
	result := response.MessageStatuses{Statuses: make([]response.MessageStatus, 0, len(statuses))}
	for _, status := range statuses {
		result.Statuses = append(result.Statuses, response.MessageStatus{
			MessageID: status.MessageID, RecalledAt: response.FormatNullableProtocolTime(status.RecalledAt),
		})
	}
	context.JSON(http.StatusOK, result)
}
