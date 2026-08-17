package auth

import "errors"

var (
	ErrInvalidRequest      = errors.New("invalid login request")
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrNoAvailableChatNode = errors.New("no available chat node")
	ErrInvalidAccessToken  = errors.New("invalid access token")
	ErrAccessTokenExpired  = errors.New("access token expired")
)
