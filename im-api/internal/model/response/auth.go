package response

import "time"

type Login struct {
	AccessToken          string `json:"access_token"`
	RefreshToken         string `json:"refresh_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
}

type Refresh struct {
	AccessToken          string `json:"access_token"`
	AccessTokenExpiresAt string `json:"access_token_expires_at"`
}

func NewLogin(accessToken string, refreshToken string, accessTokenExpiresAt time.Time) Login {
	return Login{
		AccessToken:          accessToken,
		RefreshToken:         refreshToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
	}
}

func NewRefresh(accessToken string, accessTokenExpiresAt time.Time) Refresh {
	return Refresh{
		AccessToken:          accessToken,
		AccessTokenExpiresAt: formatProtocolTime(accessTokenExpiresAt),
	}
}
