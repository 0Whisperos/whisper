package mysql

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrDuplicateAccount = errors.New("account already exists")

func FindUserByAccount(account string) (entity.User, bool, error) {
	if global.MysqlDB == nil {
		return entity.User{}, false, ErrNotInitialized
	}

	var user entity.User
	err := global.MysqlDB.WithContext(context.Background()).Where("account = ?", account).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.User{}, false, nil
	}
	if err != nil {
		return entity.User{}, false, fmt.Errorf("find user by account: %w", err)
	}

	return user, true, nil
}

func FindUsersByIDs(userIDs []uint64) ([]entity.User, error) {
	if global.MysqlDB == nil {
		return nil, ErrNotInitialized
	}
	if len(userIDs) == 0 {
		return []entity.User{}, nil
	}
	sort.Slice(userIDs, func(i, j int) bool { return userIDs[i] < userIDs[j] })
	var users []entity.User
	if err := global.MysqlDB.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, fmt.Errorf("find users by ids: %w", err)
	}
	return users, nil
}

func FindUserByID(userID uint64) (entity.User, bool, error) {
	if global.MysqlDB == nil {
		return entity.User{}, false, ErrNotInitialized
	}

	var user entity.User
	err := global.MysqlDB.WithContext(context.Background()).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.User{}, false, nil
	}
	if err != nil {
		return entity.User{}, false, fmt.Errorf("find user by id: %w", err)
	}

	return user, true, nil
}

func CreateUser(user *entity.User) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(user).Error; err != nil {
		if isDuplicateKeyError(err) {
			return ErrDuplicateAccount
		}
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}

type UserProfileUpdate struct {
	Nickname        string
	Signature       string
	UpdateAvatar    bool
	AvatarObjectKey *string
}

func UpdateUserProfile(ctx context.Context, userID uint64, update UserProfileUpdate) (entity.User, *string, bool, error) {
	if global.MysqlDB == nil {
		return entity.User{}, nil, false, ErrNotInitialized
	}

	var updated entity.User
	var oldAvatar *string
	found := true
	err := global.MysqlDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user entity.User
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			found = false
			return nil
		}
		if err != nil {
			return fmt.Errorf("find user for profile update: %w", err)
		}
		if user.AvatarObjectKey != nil {
			value := *user.AvatarObjectKey
			oldAvatar = &value
		}

		values := map[string]any{
			"nickname":  update.Nickname,
			"signature": update.Signature,
		}
		if update.UpdateAvatar {
			values["avatar_object_key"] = update.AvatarObjectKey
		}
		if err := tx.Model(&user).Updates(values).Error; err != nil {
			return fmt.Errorf("save user profile: %w", err)
		}
		if err := tx.Where("id = ?", userID).First(&updated).Error; err != nil {
			return fmt.Errorf("reload user profile: %w", err)
		}
		return nil
	})
	if err != nil {
		return entity.User{}, nil, false, err
	}
	return updated, oldAvatar, found, nil
}

func isDuplicateKeyError(err error) bool {
	var mysqlError *mysqldriver.MySQLError
	return errors.As(err, &mysqlError) && mysqlError.Number == 1062
}
