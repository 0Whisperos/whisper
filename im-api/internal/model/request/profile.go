package request

import (
	"bytes"
	"encoding/json"
)

type AvatarUploadAuthorization struct {
	ContentType string `json:"content_type"`
}

type NullableString struct {
	Present bool
	Value   *string
}

func (value *NullableString) UnmarshalJSON(data []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var decoded string
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	value.Value = &decoded
	return nil
}

type UpdateProfile struct {
	Nickname        string         `json:"nickname"`
	Signature       string         `json:"signature"`
	AvatarObjectKey NullableString `json:"avatar_object_key"`
}
