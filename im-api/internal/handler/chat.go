package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	chatservice "github.com/0Whisperos/whisper/im-server/internal/service/chat"
	"github.com/gin-gonic/gin"
)

func Me(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}

	user, err := chatservice.GetUser(userID)
	if writeError(context, err, chatErrorMappings...) {
		return
	}
	context.JSON(http.StatusOK, profileResponse(user))
}

func Friends(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}

	friends, err := chatservice.ListFriends(userID)
	if writeError(context, err, chatErrorMappings...) {
		return
	}
	result := make([]response.Friend, 0, len(friends))
	for _, friend := range friends {
		result = append(result, response.Friend{
			UserProfile:     profileResponse(friend.User),
			FriendshipState: friend.FriendshipState,
			ConversationID:  friend.ConversationID,
		})
	}
	context.JSON(http.StatusOK, gin.H{"friends": result})
}

func ConversationMessages(context *gin.Context) {
	userID, ok := middleware.UserID(context)
	if !ok {
		context.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
		return
	}

	conversationID, err := strconv.ParseUint(context.Param("conversation_id"), 10, 64)
	if err != nil || conversationID == 0 {
		writeError(context, chatservice.ErrInvalidPagination, chatErrorMappings...)
		return
	}

	beforeSeq, fromSeq, limit, err := parseMessageQuery(context)
	if err != nil {
		writeError(context, err, chatErrorMappings...)
		return
	}

	page, err := chatservice.ListConversationMessages(userID, conversationID, beforeSeq, fromSeq, limit)
	if writeError(context, err, chatErrorMappings...) {
		return
	}
	result := response.MessagePage{
		Messages:      make([]response.Message, 0, len(page.Messages)),
		HasMore:       page.HasMore,
		NextBeforeSeq: page.NextBeforeSeq,
		NextFromSeq:   page.NextFromSeq,
	}
	for _, message := range page.Messages {
		result.Messages = append(result.Messages, messageResponse(message))
	}
	context.JSON(http.StatusOK, result)
}

var chatErrorMappings = []errorMapping{
	{Err: chatservice.ErrUserNotFound, StatusCode: http.StatusNotFound, ErrorCode: "user_not_found", Message: "user not found"},
	{Err: chatservice.ErrConversationNotFound, StatusCode: http.StatusNotFound, ErrorCode: "conversation_not_found", Message: "conversation not found"},
	{Err: chatservice.ErrNotConversationMember, StatusCode: http.StatusForbidden, ErrorCode: "not_conversation_member", Message: "not a conversation member"},
	{Err: chatservice.ErrInvalidPagination, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_pagination", Message: "invalid pagination"},
}

func parseMessageQuery(context *gin.Context) (*uint64, *uint64, int, error) {
	var beforeSeq *uint64
	var fromSeq *uint64
	for name, target := range map[string](**uint64){"before_seq": &beforeSeq, "from_seq": &fromSeq} {
		value, exists := context.GetQuery(name)
		if !exists || value == "" {
			continue
		}
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return nil, nil, 0, chatservice.ErrInvalidPagination
		}
		*target = &parsed
	}

	limit := 0
	if value, exists := context.GetQuery("limit"); exists {
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil || parsed > uint64(chatservice.MaxMessagePageSize) || parsed == 0 {
			return nil, nil, 0, chatservice.ErrInvalidPagination
		}
		limit = int(parsed)
	}
	return beforeSeq, fromSeq, limit, nil
}

func profileResponse(user entity.User) response.UserProfile {
	return response.NewUserProfile(user.ID, user.Account, user.Nickname, user.Signature, user.AvatarObjectKey)
}

func messageResponse(message entity.Message) response.Message {
	content := json.RawMessage(message.Content)
	if len(content) == 0 {
		content = json.RawMessage(`{}`)
	}
	return response.NewMessage(
		message.MessageID,
		message.ConversationID,
		message.ConversationSeq,
		message.SenderUserID,
		message.ClientMessageID,
		message.MessageType,
		content,
		message.CreatedAt,
	)
}
