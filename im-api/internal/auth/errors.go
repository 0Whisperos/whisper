package auth

import "errors"

var (
	ErrInvalidRequest     = errors.New("invalid login request")
	ErrInvalidCredentials = errors.New("invalid credentials")
)
