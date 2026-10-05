package handler

import (
	"net/http"
	"strconv"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/middleware"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	"github.com/0Whisperos/whisper/im-server/internal/service/friends"
	"github.com/gin-gonic/gin"
)

func SearchUserByAccount(c *gin.Context) {
	user, err := friends.SearchByAccount(c.Param("account"))
	if writeError(c, err, friendErrorMappings...) {
		return
	}
	c.JSON(http.StatusOK, profileResponse(user))
}

func CreateFriendRequest(c *gin.Context) {
	userID, ok := middleware.UserID(c)
	if !ok {
		writeFriendUnauthorized(c)
		return
	}
	var payload struct {
		Account             string `json:"account"`
		VerificationMessage string `json:"verification_message"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		writeError(c, friends.ErrInvalidRequest, friendErrorMappings...)
		return
	}
	result, err := friends.Create(userID, payload.Account, payload.VerificationMessage, global.ChatRPCSecret)
	if writeError(c, err, friendErrorMappings...) {
		return
	}
	c.JSON(http.StatusCreated, friendRequestResponse(result))
}

func ListFriendRequests(c *gin.Context) {
	userID, ok := middleware.UserID(c)
	if !ok {
		writeFriendUnauthorized(c)
		return
	}
	direction := friends.Direction(c.Query("direction"))
	limit := 0
	if raw := c.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(c, friends.ErrInvalidRequest, friendErrorMappings...)
			return
		}
		limit = parsed
	}
	page, err := friends.List(userID, direction, c.Query("cursor"), limit)
	if writeError(c, err, friendErrorMappings...) {
		return
	}
	result := make([]response.FriendRequest, 0, len(page.Requests))
	for _, request := range page.Requests {
		result = append(result, friendRequestResponse(request))
	}
	c.JSON(http.StatusOK, gin.H{"requests": result, "pending_count": page.PendingCount, "next_cursor": page.NextCursor, "has_more": page.HasMore})
}

func AcceptFriendRequest(c *gin.Context) { decideFriendRequest(c, true) }
func RejectFriendRequest(c *gin.Context) { decideFriendRequest(c, false) }

func decideFriendRequest(c *gin.Context, accept bool) {
	userID, ok := middleware.UserID(c)
	if !ok {
		writeFriendUnauthorized(c)
		return
	}
	requestID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || requestID == 0 {
		writeError(c, friends.ErrInvalidRequest, friendErrorMappings...)
		return
	}
	result, err := friends.Decide(userID, requestID, accept, global.ChatRPCSecret)
	if writeError(c, err, friendErrorMappings...) {
		return
	}
	c.JSON(http.StatusOK, friendRequestResponse(result))
}

func friendRequestResponse(request friends.Request) response.FriendRequest {
	return response.FriendRequest{
		RequestID:           strconv.FormatUint(request.Request.ID, 10),
		Sender:              profileResponse(request.Sender),
		Recipient:           profileResponse(request.Recipient),
		VerificationMessage: request.Request.VerificationMessage,
		Status:              request.Request.Status,
		CreatedAt:           response.FormatProtocolTime(request.Request.CreatedAt),
		UpdatedAt:           response.FormatProtocolTime(request.Request.UpdatedAt),
	}
}

func writeFriendUnauthorized(c *gin.Context) {
	c.JSON(http.StatusUnauthorized, response.Error{ErrorCode: "invalid_token", Message: "invalid access token"})
}

var friendErrorMappings = []errorMapping{
	{Err: friends.ErrInvalidRequest, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_request", Message: "invalid friend request"},
	{Err: friends.ErrInvalidDirection, StatusCode: http.StatusBadRequest, ErrorCode: "invalid_direction", Message: "direction must be incoming or outgoing"},
	{Err: friends.ErrUserNotFound, StatusCode: http.StatusNotFound, ErrorCode: "user_not_found", Message: "user not found"},
	{Err: friends.ErrRequestNotFound, StatusCode: http.StatusNotFound, ErrorCode: "friend_request_not_found", Message: "friend request not found"},
	{Err: friends.ErrSelfRequest, StatusCode: http.StatusBadRequest, ErrorCode: "cannot_add_self", Message: "cannot add yourself"},
	{Err: friends.ErrAlreadyFriend, StatusCode: http.StatusConflict, ErrorCode: "already_friends", Message: "users are already friends"},
	{Err: friends.ErrRequestNotPending, StatusCode: http.StatusConflict, ErrorCode: "request_not_pending", Message: "friend request is not pending"},
	{Err: friends.ErrRequestPending, StatusCode: http.StatusConflict, ErrorCode: "friend_request_pending", Message: "friend request is already pending"},
}
