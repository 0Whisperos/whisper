package database

import (
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/entity"
	"gorm.io/gorm"
)

func FindUserByAccount(account string) (entity.User, bool, error) {
	database, err := connection()
	if err != nil {
		return entity.User{}, false, err
	}

	var user entity.User
	err = database.Where("account = ?", account).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.User{}, false, nil
	}
	if err != nil {
		return entity.User{}, false, fmt.Errorf("find user by account: %w", err)
	}

	return user, true, nil
}

func CreateUser(user entity.User) error {
	database, err := connection()
	if err != nil {
		return err
	}
	if err := database.Create(&user).Error; err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}
