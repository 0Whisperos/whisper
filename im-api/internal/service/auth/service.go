package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type ServiceConfig struct {
	FindUserByAccount          FindUserByAccountFunc
	SaveRefreshToken           SaveRefreshTokenFunc
	FindRefreshToken           FindRefreshTokenFunc
	UpdateRefreshTokenLastUsed UpdateRefreshTokenLastUsedFunc
	DeleteRefreshToken         DeleteRefreshTokenFunc
	SelectReadyChatNode        SelectReadyChatNodeFunc
	Now                        NowFunc
	JWTSecret                  []byte
	AccessTokenTTL             time.Duration
	RefreshTokenTTL            time.Duration
}

type Service struct {
	findUserByAccount          FindUserByAccountFunc
	saveRefreshToken           SaveRefreshTokenFunc
	findRefreshToken           FindRefreshTokenFunc
	updateRefreshTokenLastUsed UpdateRefreshTokenLastUsedFunc
	deleteRefreshToken         DeleteRefreshTokenFunc
	selectReadyChatNode        SelectReadyChatNodeFunc
	now                        NowFunc
	jwtSecret                  []byte
	accessTokenTTL             time.Duration
	refreshTokenTTL            time.Duration
}

func NewService(config ServiceConfig) *Service {
	now := config.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		findUserByAccount:          config.FindUserByAccount,
		saveRefreshToken:           config.SaveRefreshToken,
		findRefreshToken:           config.FindRefreshToken,
		updateRefreshTokenLastUsed: config.UpdateRefreshTokenLastUsed,
		deleteRefreshToken:         config.DeleteRefreshToken,
		selectReadyChatNode:        config.SelectReadyChatNode,
		now:                        now,
		jwtSecret:                  append([]byte(nil), config.JWTSecret...),
		accessTokenTTL:             config.AccessTokenTTL,
		refreshTokenTTL:            config.RefreshTokenTTL,
	}
}

func (service *Service) Login(ctx context.Context, account string, password string) (AuthResult, error) {
	if err := ValidateCredentials(account, password); err != nil {
		return AuthResult{}, ErrInvalidRequest
	}
	user, found, err := service.findUserByAccount(ctx, account)
	if err != nil {
		return AuthResult{}, err
	}
	if !found {
		return AuthResult{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return AuthResult{}, ErrInvalidCredentials
		}
		return AuthResult{}, fmt.Errorf("compare password hash: %v", err)
	}

	refreshToken, err := generateRefreshToken()
	if err != nil {
		return AuthResult{}, fmt.Errorf("generate refresh token: %w", err)
	}
	now := service.now()
	refreshRecord := RefreshTokenRecord{
		TokenHash: hashRefreshToken(refreshToken),
		UserID:    user.ID,
		IssuedAt:  now,
		ExpiresAt: now.Add(service.refreshTokenTTL),
	}
	if err := service.saveRefreshToken(ctx, refreshRecord, service.refreshTokenTTL); err != nil {
		return AuthResult{}, err
	}

	result, err := service.issueAccessResult(ctx, user.ID, now)
	if err != nil {
		return AuthResult{}, err
	}
	result.RefreshToken = refreshToken
	return result, nil
}

func (service *Service) Refresh(ctx context.Context, refreshToken string) (AuthResult, error) {
	if refreshToken == "" {
		return AuthResult{}, ErrInvalidRequest
	}
	tokenHash := hashRefreshToken(refreshToken)
	record, found, err := service.findRefreshToken(ctx, tokenHash)
	if err != nil {
		return AuthResult{}, err
	}
	if !found {
		return AuthResult{}, ErrInvalidRefreshToken
	}
	now := service.now()
	if err := service.updateRefreshTokenLastUsed(ctx, tokenHash, now); err != nil {
		return AuthResult{}, err
	}
	return service.issueAccessResult(ctx, record.UserID, now)
}

func (service *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return ErrInvalidRequest
	}
	return service.deleteRefreshToken(ctx, hashRefreshToken(refreshToken))
}

func (service *Service) VerifyAccessToken(accessToken string) (AccessClaims, error) {
	return verifyAccessToken(accessToken, service.jwtSecret, service.now())
}

func (service *Service) issueAccessResult(ctx context.Context, userID uint64, now time.Time) (AuthResult, error) {
	accessToken, expiresAt, err := signAccessToken(userID, now, service.accessTokenTTL, service.jwtSecret)
	if err != nil {
		return AuthResult{}, err
	}
	wsURL, err := service.selectReadyChatNode(ctx)
	if err != nil {
		return AuthResult{}, err
	}
	if wsURL == "" {
		return AuthResult{}, ErrNoAvailableChatNode
	}
	return AuthResult{
		AccessToken:          accessToken,
		AccessTokenExpiresAt: expiresAt,
		IMChatWSURL:          wsURL,
	}, nil
}
