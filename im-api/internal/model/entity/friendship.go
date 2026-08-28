package entity

import "time"

type Friendship struct {
	UserID          uint64    `gorm:"column:user_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false"`
	FriendUserID    uint64    `gorm:"column:friend_user_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false;index:idx_friendships_friend_user,priority:1"`
	FriendshipState string    `gorm:"column:friendship_state;type:varchar(16);not null;index:idx_friendships_friend_user,priority:2"`
	CreatedAt       time.Time `gorm:"column:created_at;type:datetime(6);not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;type:datetime(6);not null"`
}

func (Friendship) TableName() string {
	return "friendships"
}
