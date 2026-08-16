package auth

import "time"

type LoginResult struct {
	Account     string
	AccessToken string
	ExpiresAt   time.Time
}
