package jwt

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	jwtv5 "github.com/golang-jwt/jwt/v5"
)

var (
	secret         []byte
	accessTokenTTL time.Duration
)

type AccessClaims struct {
	UserID    uint64
	ExpiresAt time.Time
}

type accessTokenPayload struct {
	jwtv5.RegisteredClaims
	TokenType string `json:"typ"`
}

func Configure(accessSecret []byte, ttl time.Duration) {
	secret = append([]byte(nil), accessSecret...)
	accessTokenTTL = ttl
}

func SignAccessToken(userID uint64, now time.Time) (string, time.Time, error) {
	if len(secret) == 0 || accessTokenTTL <= 0 {
		return "", time.Time{}, ErrNotConfigured
	}
	expiresAt := now.Add(accessTokenTTL)
	claims := accessTokenPayload{
		RegisteredClaims: jwtv5.RegisteredClaims{
			Subject:   strconv.FormatUint(userID, 10),
			IssuedAt:  jwtv5.NewNumericDate(now),
			ExpiresAt: jwtv5.NewNumericDate(expiresAt),
		},
		TokenType: "access",
	}
	token := jwtv5.NewWithClaims(jwtv5.SigningMethodHS256, claims)
	tokenValue, err := token.SignedString(secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return tokenValue, expiresAt, nil
}

func VerifyAccessToken(tokenValue string, now time.Time) (AccessClaims, error) {
	if len(secret) == 0 {
		return AccessClaims{}, ErrNotConfigured
	}
	parser := jwtv5.NewParser(jwtv5.WithTimeFunc(func() time.Time { return now }))
	parsed, err := parser.ParseWithClaims(tokenValue, &accessTokenPayload{}, func(token *jwtv5.Token) (any, error) {
		if token.Method != jwtv5.SigningMethodHS256 {
			return nil, ErrInvalidToken
		}
		return secret, nil
	})
	if err != nil {
		if errors.Is(err, jwtv5.ErrTokenExpired) {
			return AccessClaims{}, ErrTokenExpired
		}
		return AccessClaims{}, ErrInvalidToken
	}
	payload, ok := parsed.Claims.(*accessTokenPayload)
	if !ok || !parsed.Valid || payload.TokenType != "access" || payload.Subject == "" || payload.ExpiresAt == nil {
		return AccessClaims{}, ErrInvalidToken
	}
	userID, err := strconv.ParseUint(payload.Subject, 10, 64)
	if err != nil {
		return AccessClaims{}, ErrInvalidToken
	}
	return AccessClaims{
		UserID:    userID,
		ExpiresAt: payload.ExpiresAt.Time,
	}, nil
}
