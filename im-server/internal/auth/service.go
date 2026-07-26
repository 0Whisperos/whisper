package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/database"
	"github.com/0Whisperos/whisper/im-server/internal/entity"
	"golang.org/x/crypto/bcrypt"
)

func Login(account string, password string) (LoginResult, error) {
	if err := ValidateCredentials(account, password); err != nil {
		return LoginResult{}, ErrInvalidRequest
	}

	user, found, err := database.FindUserByAccount(account)
	if err != nil {
		return LoginResult{}, err
	}
	if !found {
		return LoginResult{}, ErrInvalidCredentials
	}

	err = bcrypt.CompareHashAndPassword(
		[]byte(user.PasswordHash),
		[]byte(password),
	)
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return LoginResult{}, ErrInvalidCredentials
		}

		return LoginResult{}, fmt.Errorf("compare password hash: %v", err)
	}

	token, err := generateAccessToken()
	if err != nil {
		return LoginResult{}, fmt.Errorf("generate access token: %v", err)
	}

	expiresAt := time.Now().UTC().Add(7 * 24 * time.Hour)
	session := entity.Session{
		UserID:    user.ID,
		TokenHash: hashAccessToken(token),
		ExpiresAt: expiresAt,
	}
	if err = database.CreateSession(session); err != nil {
		return LoginResult{}, err
	}

	return LoginResult{
		Account:     user.Account,
		AccessToken: token,
		ExpiresAt:   expiresAt,
	}, nil
}

func Logout(accessToken string) error {
	if accessToken == "" {
		return nil
	}
	tokenHash := hashAccessToken(accessToken)
	return database.RevokeActiveSessionByTokenHash(tokenHash)
}
