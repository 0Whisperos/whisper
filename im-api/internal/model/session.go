package model

import "time"

type Session struct {
	ID        uint64     `gorm:"primaryKey"`
	UserID    uint64     `gorm:"not null;index"`
	User      User       `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	TokenHash string     `gorm:"size:64;not null;uniqueIndex"`
	ExpiresAt time.Time  `gorm:"not null;index"`
	RevokedAt *time.Time `gorm:"index"`
	CreatedAt time.Time
	UpdatedAt time.Time
}
