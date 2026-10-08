package profile

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/png"
	"mime"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

const MaxAvatarSize int64 = 5 * 1024 * 1024
const MaxAvatarPixels uint64 = 16 * 1024 * 1024

type UploadAuthorization struct {
	ObjectKey string
	storage.PresignedRequest
}

type DownloadAuthorization struct {
	ObjectKey string
	storage.PresignedRequest
}

var (
	objectStore       storage.Store
	objectPrefix      = "avatars/"
	findUserByID      = mysql.FindUserByID
	updateUserProfile = mysql.UpdateUserProfile
	randomRead        = rand.Read
)

func Configure(store storage.Store, prefix string) {
	objectStore = store
	objectPrefix = strings.Trim(prefix, "/") + "/"
}

func AuthorizeAvatarUpload(ctx context.Context, userID uint64, contentType string) (UploadAuthorization, error) {
	if objectStore == nil {
		return UploadAuthorization{}, ErrStorageNotConfigured
	}
	if normalizeContentType(contentType) != "image/png" {
		return UploadAuthorization{}, ErrInvalidAvatar
	}
	key, err := newAvatarKey(userID)
	if err != nil {
		return UploadAuthorization{}, fmt.Errorf("generate avatar key: %w", err)
	}
	request, err := objectStore.PresignPut(ctx, key, "image/png")
	if err != nil {
		return UploadAuthorization{}, fmt.Errorf("authorize avatar upload: %w", err)
	}
	return UploadAuthorization{ObjectKey: key, PresignedRequest: request}, nil
}

func AuthorizeAvatarDownload(ctx context.Context, userID uint64) (DownloadAuthorization, error) {
	if objectStore == nil {
		return DownloadAuthorization{}, ErrStorageNotConfigured
	}
	user, found, err := findUserByID(userID)
	if err != nil {
		return DownloadAuthorization{}, fmt.Errorf("find user for avatar download: %w", err)
	}
	if !found {
		return DownloadAuthorization{}, ErrUserNotFound
	}
	if user.AvatarObjectKey == nil || *user.AvatarObjectKey == "" {
		return DownloadAuthorization{}, ErrAvatarNotFound
	}
	request, err := objectStore.PresignGet(ctx, *user.AvatarObjectKey)
	if err != nil {
		return DownloadAuthorization{}, fmt.Errorf("authorize avatar download: %w", err)
	}
	return DownloadAuthorization{ObjectKey: *user.AvatarObjectKey, PresignedRequest: request}, nil
}

func UpdateProfile(ctx context.Context, userID uint64, nickname, signature string, avatarSet bool, avatarKey *string) (entity.User, error) {
	var pendingKey string
	var committedAvatarKey *string
	if avatarSet && avatarKey != nil {
		committedKey, ok, err := pendingToCommittedKey(userID, *avatarKey)
		if err != nil {
			return entity.User{}, err
		}
		if !ok {
			return entity.User{}, ErrAvatarKeyForbidden
		}
		pendingKey = *avatarKey
		committedAvatarKey = &committedKey
		defer deleteBestEffort(ctx, pendingKey, "delete pending avatar object")
	}

	nickname = strings.TrimSpace(nickname)
	if utf8.RuneCountInString(nickname) < 1 || utf8.RuneCountInString(nickname) > 15 || utf8.RuneCountInString(signature) > 80 {
		return entity.User{}, ErrInvalidProfile
	}

	_, found, err := findUserByID(userID)
	if err != nil {
		return entity.User{}, fmt.Errorf("find user before profile update: %w", err)
	}
	if !found {
		return entity.User{}, ErrUserNotFound
	}

	if pendingKey != "" {
		avatar, err := validateAvatarObject(ctx, pendingKey)
		if err != nil {
			return entity.User{}, err
		}
		if err := objectStore.WriteObject(ctx, *committedAvatarKey, avatar.Data, avatar.ContentType); err != nil {
			return entity.User{}, fmt.Errorf("commit avatar object: %w", err)
		}
	}

	databaseAvatarKey := avatarKey
	if committedAvatarKey != nil {
		databaseAvatarKey = committedAvatarKey
	}
	updated, oldAvatar, found, err := updateUserProfile(ctx, userID, mysql.UserProfileUpdate{
		Nickname:        nickname,
		Signature:       signature,
		UpdateAvatar:    avatarSet,
		AvatarObjectKey: databaseAvatarKey,
	})
	if err != nil {
		return entity.User{}, fmt.Errorf("update user profile: %w", err)
	}
	if !found {
		if committedAvatarKey != nil {
			deleteBestEffort(ctx, *committedAvatarKey, "delete avatar after profile user disappeared")
		}
		return entity.User{}, ErrUserNotFound
	}
	if avatarSet && oldAvatar != nil && (updated.AvatarObjectKey == nil || *oldAvatar != *updated.AvatarObjectKey) {
		deleteBestEffort(ctx, *oldAvatar, "delete replaced avatar object")
	}
	return updated, nil
}

type validatedAvatar struct {
	Data        []byte
	ContentType string
}

func validateAvatarObject(ctx context.Context, key string) (validatedAvatar, error) {
	if objectStore == nil {
		return validatedAvatar{}, ErrStorageNotConfigured
	}
	object, err := objectStore.ReadObject(ctx, key, MaxAvatarSize)
	if errors.Is(err, storage.ErrObjectNotFound) {
		return validatedAvatar{}, ErrAvatarNotFound
	}
	if err != nil {
		return validatedAvatar{}, fmt.Errorf("read avatar object: %w", err)
	}
	if object.Size > MaxAvatarSize || int64(len(object.Data)) > MaxAvatarSize {
		return validatedAvatar{}, ErrAvatarTooLarge
	}
	imageConfig, format, err := image.DecodeConfig(bytes.NewReader(object.Data))
	if err != nil || imageConfig.Width <= 0 || imageConfig.Height <= 0 || format != "png" || !strings.HasSuffix(key, ".png") {
		return validatedAvatar{}, ErrUnsupportedAvatar
	}
	if uint64(imageConfig.Width)*uint64(imageConfig.Height) > MaxAvatarPixels {
		return validatedAvatar{}, ErrUnsupportedAvatar
	}
	if _, decodedFormat, err := image.Decode(bytes.NewReader(object.Data)); err != nil || decodedFormat != format {
		return validatedAvatar{}, ErrUnsupportedAvatar
	}
	return validatedAvatar{Data: object.Data, ContentType: "image/png"}, nil
}

func newAvatarKey(userID uint64) (string, error) {
	var id [16]byte
	if _, err := randomRead(id[:]); err != nil {
		return "", err
	}
	return objectPrefix + "pending/" + strconv.FormatUint(userID, 10) + "/" + hex.EncodeToString(id[:]) + ".png", nil
}

func pendingToCommittedKey(userID uint64, key string) (string, bool, error) {
	prefix := objectPrefix + "pending/" + strconv.FormatUint(userID, 10) + "/"
	if !strings.HasPrefix(key, prefix) {
		return "", false, nil
	}
	name := strings.TrimPrefix(key, prefix)
	if !strings.HasSuffix(name, ".png") {
		return "", false, nil
	}
	id := strings.TrimSuffix(name, ".png")
	if len(id) != 32 || strings.Contains(id, "/") {
		return "", false, nil
	}
	if _, err := hex.DecodeString(id); err != nil {
		return "", false, nil
	}
	var committedID [16]byte
	if _, err := randomRead(committedID[:]); err != nil {
		return "", false, fmt.Errorf("generate committed avatar key: %w", err)
	}
	committedName := hex.EncodeToString(committedID[:]) + ".png"
	return objectPrefix + "committed/" + strconv.FormatUint(userID, 10) + "/" + committedName, true, nil
}

func normalizeContentType(value string) string {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	return strings.ToLower(mediaType)
}

func deleteBestEffort(ctx context.Context, key, operation string) {
	if objectStore == nil || key == "" {
		return
	}
	cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := objectStore.DeleteObject(cleanupContext, key); err != nil && !errors.Is(err, storage.ErrObjectNotFound) {
		logging.Error(operation, "object_key", key, "error", err)
	}
}
