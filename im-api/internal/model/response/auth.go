package response

import "time"

type Login struct {
	UserID               uint64 `json:"user_id"`
	AccessToken          string `json:"access_token"`
	RefreshToken         string `json:"refresh_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

type Refresh struct {
	UserID               uint64 `json:"user_id"`
	AccessToken          string `json:"access_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

func NewLogin(userID uint64, accessToken string, refreshToken string, accessTokenExpiresAt time.Time, imChatWSURL string) Login {
	return Login{
		UserID:               userID,
		AccessToken:          accessToken,
		RefreshToken:         refreshToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
		IMChatWSURL:          imChatWSURL,
	}
}

func NewRefresh(userID uint64, accessToken string, accessTokenExpiresAt time.Time, imChatWSURL string) Refresh {
	return Refresh{
		UserID:               userID,
		AccessToken:          accessToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
		IMChatWSURL:          imChatWSURL,
	}
}
