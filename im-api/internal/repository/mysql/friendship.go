package mysql

import (
	"context"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func CreateFriendship(friendship entity.Friendship) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(&friendship).Error; err != nil {
		return fmt.Errorf("create friendship: %w", err)
	}

	return nil
}

func ListActiveFriendships(userID uint64) ([]entity.Friendship, error) {
	if global.MysqlDB == nil {
		return nil, ErrNotInitialized
	}

	var friendships []entity.Friendship
	if err := global.MysqlDB.WithContext(context.Background()).
		Where("user_id = ? AND friendship_state = ?", userID, "active").
		Order("friend_user_id ASC").
		Find(&friendships).Error; err != nil {
		return nil, fmt.Errorf("list active friendships: %w", err)
	}

	return friendships, nil
}
