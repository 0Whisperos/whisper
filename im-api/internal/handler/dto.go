package handler

import (
	"context"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
)

type LoginFunc func(ctx context.Context, account string, password string) (auth.AuthResult, error)

type RefreshFunc func(ctx context.Context, refreshToken string) (auth.AuthResult, error)

type LogoutFunc func(ctx context.Context, refreshToken string) error

type loginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type logoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type loginResponse struct {
	AccessToken          string `json:"access_token"`
	RefreshToken         string `json:"refresh_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

type refreshResponse struct {
	AccessToken          string `json:"access_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

type errorResponse struct {
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
}

func formatProtocolTime(value time.Time) string {
	return value.Format("2006-01-02T15:04:05-07:00")
}
