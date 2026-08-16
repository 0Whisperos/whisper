package entity

import "time"

type User struct {
	ID           uint64 `gorm:"primaryKey"`
	Account      string `gorm:"size:12;not null;uniqueIndex"`
	PasswordHash string `gorm:"size:60;not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
