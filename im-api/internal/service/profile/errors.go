package profile

import "errors"

var (
	ErrInvalidProfile       = errors.New("invalid profile")
	ErrInvalidAvatar        = errors.New("invalid avatar")
	ErrAvatarTooLarge       = errors.New("avatar is too large")
	ErrUnsupportedAvatar    = errors.New("unsupported avatar content")
	ErrAvatarKeyForbidden   = errors.New("avatar key does not belong to user")
	ErrAvatarNotFound       = errors.New("avatar not found")
	ErrUserNotFound         = errors.New("user not found")
	ErrStorageNotConfigured = errors.New("object storage is not configured")
)
