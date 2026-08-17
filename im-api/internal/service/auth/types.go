package auth

import (
	"context"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model"
)

type AuthResult struct {
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt time.Time
	IMChatWSURL          string
}

type AccessClaims struct {
	UserID    uint64
	ExpiresAt time.Time
}

type RefreshTokenRecord struct {
	TokenHash  string
	UserID     uint64
	IssuedAt   time.Time
	ExpiresAt  time.Time
	LastUsedAt *time.Time
}

type FindUserByAccountFunc func(ctx context.Context, account string) (model.User, bool, error)

type SaveRefreshTokenFunc func(ctx context.Context, record RefreshTokenRecord, ttl time.Duration) error

type FindRefreshTokenFunc func(ctx context.Context, tokenHash string) (RefreshTokenRecord, bool, error)

type UpdateRefreshTokenLastUsedFunc func(ctx context.Context, tokenHash string, usedAt time.Time) error

type DeleteRefreshTokenFunc func(ctx context.Context, tokenHash string) error

type SelectReadyChatNodeFunc func(ctx context.Context) (string, error)

type NowFunc func() time.Time
