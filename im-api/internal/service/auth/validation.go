package auth

import (
	"fmt"
	"unicode/utf8"
)

func ValidateCredentials(account string, password string) error {
	if err := validateAccount(account); err != nil {
		return err
	}
	if password == "" {
		return fmt.Errorf("password is empty")
	}

	return nil
}

func ValidateRegistration(nickname string, password string) error {
	nicknameLength := utf8.RuneCountInString(nickname)
	if nicknameLength < 1 || nicknameLength > 15 {
		return fmt.Errorf("nickname length must be between 1 and 15")
	}
	if password == "" {
		return fmt.Errorf("password is empty")
	}

	return nil
}

func validateAccount(account string) error {
	accountLength := len(account)
	if accountLength < 8 || accountLength > 12 {
		return fmt.Errorf("account length must be between 8 and 12")
	}
	for _, value := range account {
		if value < '0' || value > '9' {
			return fmt.Errorf("account must consist of numbers only")
		}
	}

	return nil
}
