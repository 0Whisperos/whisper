package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

func generateAccessToken() (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}

	return hex.EncodeToString(tokenBytes), nil
}

func hashAccessToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}
