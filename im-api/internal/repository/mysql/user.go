package mysql

import (
	"context"
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/model"
	"gorm.io/gorm"
)

func FindUserByAccount(account string) (model.User, bool, error) {
	return FindUserByAccountContext(context.Background(), account)
}

func FindUserByAccountContext(ctx context.Context, account string) (model.User, bool, error) {
	database, err := connection()
	if err != nil {
		return model.User{}, false, err
	}

	var user model.User
	err = database.WithContext(ctx).Where("account = ?", account).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, false, nil
	}
	if err != nil {
		return model.User{}, false, fmt.Errorf("find user by account: %w", err)
	}

	return user, true, nil
}

func CreateUser(user model.User) error {
	database, err := connection()
	if err != nil {
		return err
	}
	if err := database.Create(&user).Error; err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}
