package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type accessTokenPayload struct {
	jwt.RegisteredClaims
	TokenType string `json:"typ"`
}

func generateRefreshToken() (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(tokenBytes), nil
}

func hashRefreshToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func signAccessToken(userID uint64, now time.Time, ttl time.Duration, secret []byte) (string, time.Time, error) {
	expiresAt := now.Add(ttl)
	claims := accessTokenPayload{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		TokenType: "access",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenValue, err := token.SignedString(secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return tokenValue, expiresAt, nil
}

func verifyAccessToken(tokenValue string, secret []byte, now time.Time) (AccessClaims, error) {
	parser := jwt.NewParser(jwt.WithTimeFunc(func() time.Time { return now }))
	parsed, err := parser.ParseWithClaims(tokenValue, &accessTokenPayload{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidAccessToken
		}
		return secret, nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return AccessClaims{}, ErrAccessTokenExpired
		}
		return AccessClaims{}, ErrInvalidAccessToken
	}
	payload, ok := parsed.Claims.(*accessTokenPayload)
	if !ok || !parsed.Valid || payload.TokenType != "access" || payload.Subject == "" || payload.ExpiresAt == nil {
		return AccessClaims{}, ErrInvalidAccessToken
	}
	userID, err := strconv.ParseUint(payload.Subject, 10, 64)
	if err != nil {
		return AccessClaims{}, ErrInvalidAccessToken
	}
	return AccessClaims{
		UserID:    userID,
		ExpiresAt: payload.ExpiresAt.Time,
	}, nil
}
