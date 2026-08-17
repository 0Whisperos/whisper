package entity

import "time"

type User struct {
	ID              uint64    `gorm:"column:id;type:bigint unsigned;not null;primaryKey;autoIncrement"`
	Account         string    `gorm:"column:account;type:varchar(12);not null;uniqueIndex:uk_users_account"`
	PasswordHash    string    `gorm:"column:password_hash;type:varchar(60);not null"`
	AvatarObjectKey *string   `gorm:"column:avatar_object_key;type:varchar(255)"`
	CreatedAt       time.Time `gorm:"column:created_at;type:datetime(6);not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;type:datetime(6);not null"`
}

func (User) TableName() string {
	return "users"
}
