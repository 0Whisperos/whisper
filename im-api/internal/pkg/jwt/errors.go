package jwt

import "errors"

var (
	ErrNotConfigured = errors.New("jwt is not configured")
	ErrInvalidToken  = errors.New("invalid access token")
	ErrTokenExpired  = errors.New("access token expired")
)
