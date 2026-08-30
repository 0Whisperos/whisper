package chat

import "errors"

var (
	ErrUserNotFound          = errors.New("user not found")
	ErrConversationNotFound  = errors.New("conversation not found")
	ErrNotConversationMember = errors.New("user is not a conversation member")
	ErrInvalidPagination     = errors.New("invalid pagination")
)
