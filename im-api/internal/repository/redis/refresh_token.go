package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	goredis "github.com/redis/go-redis/v9"
)

type RefreshTokenRepository struct {
	client *goredis.Client
}

type refreshTokenValue struct {
	UserID     string  `json:"user_id"`
	IssuedAt   string  `json:"issued_at"`
	ExpiresAt  string  `json:"expires_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
}

func NewRefreshTokenRepository(client *goredis.Client) *RefreshTokenRepository {
	return &RefreshTokenRepository{client: client}
}

func (repository *RefreshTokenRepository) Save(ctx context.Context, record auth.RefreshTokenRecord, ttl time.Duration) error {
	value := refreshTokenValue{
		UserID:    strconv.FormatUint(record.UserID, 10),
		IssuedAt:  formatProtocolTime(record.IssuedAt),
		ExpiresAt: formatProtocolTime(record.ExpiresAt),
	}
	if record.LastUsedAt != nil {
		lastUsedAt := formatProtocolTime(*record.LastUsedAt)
		value.LastUsedAt = &lastUsedAt
	}
	contents, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal refresh token value: %w", err)
	}
	if err := repository.client.Set(ctx, refreshTokenKey(record.TokenHash), string(contents), ttl).Err(); err != nil {
		return fmt.Errorf("save refresh token: %w", err)
	}
	return nil
}

func (repository *RefreshTokenRepository) Find(ctx context.Context, tokenHash string) (auth.RefreshTokenRecord, bool, error) {
	contents, err := repository.client.Get(ctx, refreshTokenKey(tokenHash)).Result()
	if errors.Is(err, goredis.Nil) {
		return auth.RefreshTokenRecord{}, false, nil
	}
	if err != nil {
		return auth.RefreshTokenRecord{}, false, fmt.Errorf("find refresh token: %w", err)
	}
	record, err := parseRefreshTokenRecord(tokenHash, contents)
	if err != nil {
		return auth.RefreshTokenRecord{}, false, err
	}
	return record, true, nil
}

func (repository *RefreshTokenRepository) UpdateLastUsedAt(ctx context.Context, tokenHash string, usedAt time.Time) error {
	key := refreshTokenKey(tokenHash)
	contents, err := repository.client.Get(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return auth.ErrInvalidRefreshToken
	}
	if err != nil {
		return fmt.Errorf("find refresh token for update: %w", err)
	}
	var parsed refreshTokenValue
	if err := json.Unmarshal([]byte(contents), &parsed); err != nil {
		return fmt.Errorf("parse refresh token value for update: %w", err)
	}
	lastUsedAt := formatProtocolTime(usedAt)
	parsed.LastUsedAt = &lastUsedAt
	updated, err := json.Marshal(parsed)
	if err != nil {
		return fmt.Errorf("marshal refresh token update: %w", err)
	}
	if err := repository.client.Set(ctx, key, string(updated), goredis.KeepTTL).Err(); err != nil {
		return fmt.Errorf("update refresh token last_used_at: %w", err)
	}
	return nil
}

func (repository *RefreshTokenRepository) Delete(ctx context.Context, tokenHash string) error {
	if err := repository.client.Del(ctx, refreshTokenKey(tokenHash)).Err(); err != nil {
		return fmt.Errorf("delete refresh token: %w", err)
	}
	return nil
}

func parseRefreshTokenRecord(tokenHash string, contents string) (auth.RefreshTokenRecord, error) {
	var value refreshTokenValue
	if err := json.Unmarshal([]byte(contents), &value); err != nil {
		return auth.RefreshTokenRecord{}, fmt.Errorf("parse refresh token value: %w", err)
	}
	userID, err := strconv.ParseUint(value.UserID, 10, 64)
	if err != nil {
		return auth.RefreshTokenRecord{}, fmt.Errorf("parse refresh token user id: %w", err)
	}
	issuedAt, err := time.Parse("2006-01-02T15:04:05-07:00", value.IssuedAt)
	if err != nil {
		return auth.RefreshTokenRecord{}, fmt.Errorf("parse refresh token issued_at: %w", err)
	}
	expiresAt, err := time.Parse("2006-01-02T15:04:05-07:00", value.ExpiresAt)
	if err != nil {
		return auth.RefreshTokenRecord{}, fmt.Errorf("parse refresh token expires_at: %w", err)
	}
	record := auth.RefreshTokenRecord{TokenHash: tokenHash, UserID: userID, IssuedAt: issuedAt, ExpiresAt: expiresAt}
	if value.LastUsedAt != nil {
		lastUsedAt, err := time.Parse("2006-01-02T15:04:05-07:00", *value.LastUsedAt)
		if err != nil {
			return auth.RefreshTokenRecord{}, fmt.Errorf("parse refresh token last_used_at: %w", err)
		}
		record.LastUsedAt = &lastUsedAt
	}
	return record, nil
}

func refreshTokenKey(tokenHash string) string {
	return "refresh_token:" + tokenHash
}

func formatProtocolTime(value time.Time) string {
	return value.Format("2006-01-02T15:04:05-07:00")
}
