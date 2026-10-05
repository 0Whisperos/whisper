package friends

import "errors"

var (
	ErrInvalidRequest    = errors.New("invalid friend request")
	ErrUserNotFound      = errors.New("user not found")
	ErrSelfRequest       = errors.New("cannot add self")
	ErrAlreadyFriend     = errors.New("users are already friends")
	ErrRequestNotFound   = errors.New("friend request not found")
	ErrRequestNotPending = errors.New("friend request is not pending")
	ErrRequestPending    = errors.New("friend request is already pending")
	ErrInvalidDirection  = errors.New("invalid friend request direction")
)
