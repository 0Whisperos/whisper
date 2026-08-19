package response

import "time"

type Login struct {
	AccessToken          string `json:"access_token"`
	RefreshToken         string `json:"refresh_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

type Refresh struct {
	AccessToken          string `json:"access_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
	IMChatWSURL          string `json:"im_chat_ws_url"`
}

func NewLogin(accessToken string, refreshToken string, accessTokenExpiresAt time.Time, imChatWSURL string) Login {
	return Login{
		AccessToken:          accessToken,
		RefreshToken:         refreshToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
		IMChatWSURL:          imChatWSURL,
	}
}

func NewRefresh(accessToken string, accessTokenExpiresAt time.Time, imChatWSURL string) Refresh {
	return Refresh{
		AccessToken:          accessToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
		IMChatWSURL:          imChatWSURL,
	}
}
