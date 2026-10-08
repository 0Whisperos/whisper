package storage

import (
	"context"
	"errors"
	"time"
)

var ErrObjectNotFound = errors.New("object not found")

type PresignedRequest struct {
	Method    string
	URL       string
	Headers   map[string]string
	ExpiresAt time.Time
}

type Object struct {
	Size int64
	Data []byte
}

type Store interface {
	PresignPut(context.Context, string, string) (PresignedRequest, error)
	PresignGet(context.Context, string) (PresignedRequest, error)
	ReadObject(context.Context, string, int64) (Object, error)
	WriteObject(context.Context, string, []byte, string) error
	DeleteObject(context.Context, string) error
}
