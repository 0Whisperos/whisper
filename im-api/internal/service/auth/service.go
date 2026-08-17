package auth

import (
	"errors"
	"fmt"
	"time"

	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	authjwt "github.com/0Whisperos/whisper/im-server/internal/pkg/jwt"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	redisrepo "github.com/0Whisperos/whisper/im-server/internal/repository/redis"
	"golang.org/x/crypto/bcrypt"
)

var refreshTokenTTL time.Duration

func SetTokenConfig(secret []byte, accessTTL time.Duration, refreshTTL time.Duration) {
	authjwt.Configure(secret, accessTTL)
	refreshTokenTTL = refreshTTL
}

func Login(account string, password string) (authmodel.AuthResult, error) {
	if err := ValidateCredentials(account, password); err != nil {
		return authmodel.AuthResult{}, ErrInvalidRequest
	}
	user, found, err := mysql.FindUserByAccount(account)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	if !found {
		return authmodel.AuthResult{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return authmodel.AuthResult{}, ErrInvalidCredentials
		}
		return authmodel.AuthResult{}, fmt.Errorf("compare password hash: %v", err)
	}

	refreshToken, err := generateRefreshToken()
	if err != nil {
		return authmodel.AuthResult{}, fmt.Errorf("generate refresh token: %w", err)
	}
	now := time.Now()
	refreshRecord := authmodel.RefreshTokenRecord{
		TokenHash: hashRefreshToken(refreshToken),
		UserID:    user.ID,
		IssuedAt:  now,
		ExpiresAt: now.Add(refreshTokenTTL),
	}
	if err := redisrepo.SaveRefreshToken(refreshRecord, refreshTokenTTL); err != nil {
		return authmodel.AuthResult{}, err
	}

	result, err := issueAccessResult(user.ID, now)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	result.RefreshToken = refreshToken
	return result, nil
}

func Refresh(refreshToken string) (authmodel.AuthResult, error) {
	if refreshToken == "" {
		return authmodel.AuthResult{}, ErrInvalidRequest
	}
	tokenHash := hashRefreshToken(refreshToken)
	record, found, err := redisrepo.FindRefreshToken(tokenHash)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	if !found {
		return authmodel.AuthResult{}, ErrInvalidRefreshToken
	}
	now := time.Now()
	if err := redisrepo.UpdateRefreshTokenLastUsedAt(tokenHash, now); err != nil {
		if errors.Is(err, redisrepo.ErrRefreshTokenNotFound) {
			return authmodel.AuthResult{}, ErrInvalidRefreshToken
		}
		return authmodel.AuthResult{}, err
	}
	return issueAccessResult(record.UserID, now)
}

func Logout(refreshToken string) error {
	if refreshToken == "" {
		return ErrInvalidRequest
	}
	return redisrepo.DeleteRefreshToken(hashRefreshToken(refreshToken))
}

func VerifyAccessToken(accessToken string) (authjwt.AccessClaims, error) {
	claims, err := authjwt.VerifyAccessToken(accessToken, time.Now())
	if errors.Is(err, authjwt.ErrTokenExpired) {
		return authjwt.AccessClaims{}, ErrAccessTokenExpired
	}
	if err != nil {
		return authjwt.AccessClaims{}, ErrInvalidAccessToken
	}
	return claims, nil
}

func issueAccessResult(userID uint64, now time.Time) (authmodel.AuthResult, error) {
	accessToken, expiresAt, err := authjwt.SignAccessToken(userID, now)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	return authmodel.AuthResult{
		AccessToken:          accessToken,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}
