package auth

import (
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	authmodel "github.com/0Whisperos/whisper/im-server/internal/model/auth"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	authjwt "github.com/0Whisperos/whisper/im-server/internal/pkg/jwt"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	redisrepo "github.com/0Whisperos/whisper/im-server/internal/repository/redis"
	"golang.org/x/crypto/bcrypt"
)

var refreshTokenTTL time.Duration
var findUserByAccount = mysql.FindUserByAccount
var createRegisterUser = mysql.CreateUser
var generateRegisterAccount = generateAccount

const maxRegistrationAttempts = 10

func SetTokenConfig(secret []byte, accessTTL time.Duration, refreshTTL time.Duration) {
	authjwt.Configure(secret, accessTTL)
	refreshTokenTTL = refreshTTL
}

func Login(account string, password string) (authmodel.AuthResult, error) {
	user, err := authenticateUser(account, password)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	if err := redisrepo.DeleteRefreshTokenByUser(user.ID); err != nil {
		return authmodel.AuthResult{}, err
	}
	return issueLoginResult(user.ID)
}

func Register(nickname string, password string) (string, error) {
	nickname = strings.TrimSpace(nickname)
	if err := ValidateRegistration(nickname, password); err != nil {
		return "", ErrInvalidRequest
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash registration password: %w", err)
	}

	for attempt := 0; attempt < maxRegistrationAttempts; attempt++ {
		account, err := generateRegisterAccount()
		if err != nil {
			return "", fmt.Errorf("generate registration account: %w", err)
		}
		user := entity.User{
			Account:      account,
			PasswordHash: string(hash),
			Nickname:     nickname,
		}
		if err := createRegisterUser(&user); err != nil {
			if errors.Is(err, mysql.ErrDuplicateAccount) {
				continue
			}
			return "", err
		}
		return account, nil
	}

	return "", ErrRegistrationFailed
}

func generateAccount() (string, error) {
	lengthValue, err := cryptorand.Int(cryptorand.Reader, big.NewInt(5))
	if err != nil {
		return "", fmt.Errorf("generate account length: %w", err)
	}

	accountLength := 8 + int(lengthValue.Int64())
	var account strings.Builder
	account.Grow(accountLength)
	for index := 0; index < accountLength; index++ {
		digit, err := cryptorand.Int(cryptorand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("generate account digit: %w", err)
		}
		account.WriteByte(byte('0' + digit.Int64()))
	}

	return account.String(), nil
}

func authenticateUser(account string, password string) (entity.User, error) {
	if err := ValidateCredentials(account, password); err != nil {
		return entity.User{}, ErrInvalidRequest
	}
	user, found, err := findUserByAccount(account)
	if err != nil {
		return entity.User{}, err
	}
	if !found {
		return entity.User{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return entity.User{}, ErrInvalidCredentials
		}
		return entity.User{}, fmt.Errorf("compare password hash: %v", err)
	}
	return user, nil
}

func issueLoginResult(userID uint64) (authmodel.AuthResult, error) {
	refreshToken, err := generateRefreshToken()
	if err != nil {
		return authmodel.AuthResult{}, fmt.Errorf("generate refresh token: %w", err)
	}
	now := time.Now()
	result, err := issueAccessResult(userID, now)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	chatNode, found, err := redisrepo.SelectReadyChatNode()
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	if !found {
		return authmodel.AuthResult{}, ErrNoAvailableChatNode
	}
	refreshRecord := authmodel.RefreshTokenRecord{
		TokenHash: hashRefreshToken(refreshToken),
		UserID:    userID,
		IssuedAt:  now,
		ExpiresAt: now.Add(refreshTokenTTL),
	}
	if err := redisrepo.SaveRefreshToken(refreshRecord, refreshTokenTTL); err != nil {
		return authmodel.AuthResult{}, err
	}
	result.RefreshToken = refreshToken
	result.IMChatWSURL = chatNode.PublicWSURL
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
	result, err := issueAccessResult(record.UserID, now)
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	chatNode, found, err := redisrepo.SelectReadyChatNode()
	if err != nil {
		return authmodel.AuthResult{}, err
	}
	if !found {
		return authmodel.AuthResult{}, ErrNoAvailableChatNode
	}
	result.IMChatWSURL = chatNode.PublicWSURL
	return result, nil
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
		UserID:               userID,
		AccessToken:          accessToken,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}
