package auth

import "time"

type AuthResult struct {
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt time.Time
	IMChatWSURL          string
}

type RefreshTokenRecord struct {
	TokenHash  string
	UserID     uint64
	IssuedAt   time.Time
	ExpiresAt  time.Time
	LastUsedAt *time.Time
}
