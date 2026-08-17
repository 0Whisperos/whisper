package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	goredis "github.com/redis/go-redis/v9"
)

type refreshTokenValue struct {
	UserID     string  `json:"user_id"`
	IssuedAt   string  `json:"issued_at"`
	ExpiresAt  string  `json:"expires_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
}

func SaveRefreshToken(record authmodel.RefreshTokenRecord, ttl time.Duration) error {
	if global.RedisClient == nil {
		return ErrNotInitialized
	}
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
	if err := global.RedisClient.Set(context.Background(), refreshTokenKey(record.TokenHash), string(contents), ttl).Err(); err != nil {
		return fmt.Errorf("save refresh token: %w", err)
	}
	return nil
}

func FindRefreshToken(tokenHash string) (authmodel.RefreshTokenRecord, bool, error) {
	if global.RedisClient == nil {
		return authmodel.RefreshTokenRecord{}, false, ErrNotInitialized
	}
	contents, err := global.RedisClient.Get(context.Background(), refreshTokenKey(tokenHash)).Result()
	if errors.Is(err, goredis.Nil) {
		return authmodel.RefreshTokenRecord{}, false, nil
	}
	if err != nil {
		return authmodel.RefreshTokenRecord{}, false, fmt.Errorf("find refresh token: %w", err)
	}
	record, err := parseRefreshTokenRecord(tokenHash, contents)
	if err != nil {
		return authmodel.RefreshTokenRecord{}, false, err
	}
	return record, true, nil
}

func UpdateRefreshTokenLastUsedAt(tokenHash string, usedAt time.Time) error {
	if global.RedisClient == nil {
		return ErrNotInitialized
	}
	key := refreshTokenKey(tokenHash)
	contents, err := global.RedisClient.Get(context.Background(), key).Result()
	if errors.Is(err, goredis.Nil) {
		return ErrRefreshTokenNotFound
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
	if err := global.RedisClient.Set(context.Background(), key, string(updated), goredis.KeepTTL).Err(); err != nil {
		return fmt.Errorf("update refresh token last_used_at: %w", err)
	}
	return nil
}

func DeleteRefreshToken(tokenHash string) error {
	if global.RedisClient == nil {
		return ErrNotInitialized
	}
	if err := global.RedisClient.Del(context.Background(), refreshTokenKey(tokenHash)).Err(); err != nil {
		return fmt.Errorf("delete refresh token: %w", err)
	}
	return nil
}

func parseRefreshTokenRecord(tokenHash string, contents string) (authmodel.RefreshTokenRecord, error) {
	var value refreshTokenValue
	if err := json.Unmarshal([]byte(contents), &value); err != nil {
		return authmodel.RefreshTokenRecord{}, fmt.Errorf("parse refresh token value: %w", err)
	}
	userID, err := strconv.ParseUint(value.UserID, 10, 64)
	if err != nil {
		return authmodel.RefreshTokenRecord{}, fmt.Errorf("parse refresh token user id: %w", err)
	}
	issuedAt, err := time.Parse("2006-01-02T15:04:05-07:00", value.IssuedAt)
	if err != nil {
		return authmodel.RefreshTokenRecord{}, fmt.Errorf("parse refresh token issued_at: %w", err)
	}
	expiresAt, err := time.Parse("2006-01-02T15:04:05-07:00", value.ExpiresAt)
	if err != nil {
		return authmodel.RefreshTokenRecord{}, fmt.Errorf("parse refresh token expires_at: %w", err)
	}
	record := authmodel.RefreshTokenRecord{TokenHash: tokenHash, UserID: userID, IssuedAt: issuedAt, ExpiresAt: expiresAt}
	if value.LastUsedAt != nil {
		lastUsedAt, err := time.Parse("2006-01-02T15:04:05-07:00", *value.LastUsedAt)
		if err != nil {
			return authmodel.RefreshTokenRecord{}, fmt.Errorf("parse refresh token last_used_at: %w", err)
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
