package model

import "time"

type OutboxEvent struct {
	ID            string    `gorm:"column:id;type:char(36);not null;primaryKey"`
	AggregateType string    `gorm:"column:aggregatetype;type:varchar(255);not null"`
	AggregateID   string    `gorm:"column:aggregateid;type:varchar(255);not null"`
	Type          string    `gorm:"column:type;type:varchar(255);not null"`
	Payload       JSONValue `gorm:"column:payload;type:json;not null"`
	CreatedAt     time.Time `gorm:"column:created_at;type:datetime(6);not null;index:idx_outbox_events_created"`
}

func (OutboxEvent) TableName() string {
	return "outbox_events"
}
