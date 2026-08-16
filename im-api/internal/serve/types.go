package serve

import "time"

type loginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

type loginResponse struct {
	AccessToken string    `json:"accessToken"`
	Account     string    `json:"account"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type errorResponse struct {
	Error string `json:"error"`
}
