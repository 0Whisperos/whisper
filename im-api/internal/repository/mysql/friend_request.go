package mysql

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrFriendRequestNotFound       = errors.New("friend request not found")
	ErrFriendRequestNotPending     = errors.New("friend request is not pending")
	ErrFriendRequestAlreadyPending = errors.New("friend request is already pending")
	ErrFriendshipAlreadyExists     = errors.New("friendship already exists")
)

// CreateOrRefreshFriendRequest stores the single current request for a direction.
// If the other direction is already pending, both requests are accepted atomically.
func CreateOrRefreshFriendRequest(request *entity.FriendRequest) (bool, error) {
	if global.MysqlDB == nil {
		return false, ErrNotInitialized
	}
	autoAccepted := false
	err := global.MysqlDB.Transaction(func(tx *gorm.DB) error {
		if err := lockUsers(tx, request.SenderUserID, request.RecipientUserID); err != nil {
			return err
		}
		var friendshipCount int64
		if err := tx.Model(&entity.Friendship{}).Where("((user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)) AND friendship_state = ?", request.SenderUserID, request.RecipientUserID, request.RecipientUserID, request.SenderUserID, "active").Count(&friendshipCount).Error; err != nil {
			return fmt.Errorf("check existing friendship in transaction: %w", err)
		}
		if friendshipCount > 0 {
			return ErrFriendshipAlreadyExists
		}
		var existing entity.FriendRequest
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sender_user_id = ? AND recipient_user_id = ?", request.SenderUserID, request.RecipientUserID).First(&existing).Error
		now := time.Now()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			request.Status, request.CreatedAt, request.UpdatedAt = "pending", now, now
			if err := tx.Create(request).Error; err != nil {
				return fmt.Errorf("create friend request: %w", err)
			}
		} else if err != nil {
			return fmt.Errorf("find friend request direction: %w", err)
		} else {
			if existing.Status == "pending" {
				return ErrFriendRequestAlreadyPending
			}
			existing.VerificationMessage, existing.Status, existing.CreatedAt, existing.UpdatedAt = request.VerificationMessage, "pending", now, now
			if err := tx.Save(&existing).Error; err != nil {
				return fmt.Errorf("refresh friend request: %w", err)
			}
			*request = existing
		}
		var reverse entity.FriendRequest
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sender_user_id = ? AND recipient_user_id = ? AND status = ?", request.RecipientUserID, request.SenderUserID, "pending").First(&reverse).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("find reverse friend request: %w", err)
		}
		if err := acceptFriendPair(tx, request.SenderUserID, request.RecipientUserID, now); err != nil {
			return err
		}
		if err := tx.Model(&entity.FriendRequest{}).Where("id IN ?", []uint64{request.ID, reverse.ID}).Updates(map[string]interface{}{"status": "accepted", "updated_at": now}).Error; err != nil {
			return fmt.Errorf("accept mutual friend requests: %w", err)
		}
		request.Status, request.UpdatedAt = "accepted", now
		autoAccepted = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return autoAccepted, nil
}

func ListFriendRequests(userID uint64, direction string, beforeCreatedAt *time.Time, beforeID uint64, limit int) ([]entity.FriendRequest, int64, bool, error) {
	if global.MysqlDB == nil {
		return nil, 0, false, ErrNotInitialized
	}
	column := "recipient_user_id"
	if direction == "outgoing" {
		column = "sender_user_id"
	}
	var pendingCount int64
	if err := global.MysqlDB.Model(&entity.FriendRequest{}).Where("recipient_user_id = ? AND status = ?", userID, "pending").Count(&pendingCount).Error; err != nil {
		return nil, 0, false, fmt.Errorf("count pending friend requests: %w", err)
	}
	query := global.MysqlDB.Where(column+" = ?", userID)
	if beforeCreatedAt != nil {
		query = query.Where("(created_at < ?) OR (created_at = ? AND id < ?)", *beforeCreatedAt, *beforeCreatedAt, beforeID)
	}
	var requests []entity.FriendRequest
	if err := query.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&requests).Error; err != nil {
		return nil, 0, false, fmt.Errorf("list friend requests: %w", err)
	}
	hasMore := len(requests) > limit
	if hasMore {
		requests = requests[:limit]
	}
	return requests, pendingCount, hasMore, nil
}

func FindFriendRequestID(senderID, recipientID uint64) (uint64, bool, error) {
	if global.MysqlDB == nil {
		return 0, false, ErrNotInitialized
	}
	var request entity.FriendRequest
	err := global.MysqlDB.Select("id").Where("sender_user_id = ? AND recipient_user_id = ?", senderID, recipientID).First(&request).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("find friend request id: %w", err)
	}
	return request.ID, true, nil
}

// DecideFriendRequest accepts or rejects a pending request owned by recipientID.
func DecideFriendRequest(requestID, recipientID uint64, accept bool) (entity.FriendRequest, error) {
	if global.MysqlDB == nil {
		return entity.FriendRequest{}, ErrNotInitialized
	}
	var result entity.FriendRequest
	err := global.MysqlDB.Transaction(func(tx *gorm.DB) error {
		var initial entity.FriendRequest
		if err := tx.First(&initial, requestID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFriendRequestNotFound
		} else if err != nil {
			return fmt.Errorf("find friend request: %w", err)
		}
		if initial.RecipientUserID != recipientID {
			return ErrFriendRequestNotFound
		}
		if err := lockUsers(tx, initial.SenderUserID, recipientID); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&result, requestID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFriendRequestNotFound
		} else if err != nil {
			return fmt.Errorf("lock friend request: %w", err)
		}
		if result.RecipientUserID != recipientID {
			return ErrFriendRequestNotFound
		}
		if result.Status != "pending" {
			return ErrFriendRequestNotPending
		}
		now := time.Now()
		status := "rejected"
		if accept {
			status = "accepted"
			if err := acceptFriendPair(tx, result.SenderUserID, result.RecipientUserID, now); err != nil {
				return err
			}
			if err := tx.Model(&entity.FriendRequest{}).Where("sender_user_id = ? AND recipient_user_id = ? AND status = ?", result.RecipientUserID, result.SenderUserID, "pending").Updates(map[string]interface{}{"status": "accepted", "updated_at": now}).Error; err != nil {
				return fmt.Errorf("accept reverse friend request: %w", err)
			}
		}
		if err := tx.Model(&result).Updates(map[string]interface{}{"status": status, "updated_at": now}).Error; err != nil {
			return fmt.Errorf("decide friend request: %w", err)
		}
		result.Status, result.UpdatedAt = status, now
		return nil
	})
	if err != nil {
		return entity.FriendRequest{}, err
	}
	return result, nil
}

func lockUsers(tx *gorm.DB, userIDs ...uint64) error {
	sort.Slice(userIDs, func(i, j int) bool { return userIDs[i] < userIDs[j] })
	for _, id := range userIDs {
		var user entity.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&user, id).Error; err != nil {
			return fmt.Errorf("lock friend request user: %w", err)
		}
	}
	return nil
}

func acceptFriendPair(tx *gorm.DB, first, second uint64, now time.Time) error {
	for _, pair := range [][2]uint64{{first, second}, {second, first}} {
		friendship := entity.Friendship{UserID: pair[0], FriendUserID: pair[1], FriendshipState: "active", CreatedAt: now, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "friend_user_id"}}, DoUpdates: clause.Assignments(map[string]interface{}{"friendship_state": "active", "updated_at": now})}).Create(&friendship).Error; err != nil {
			return fmt.Errorf("upsert friendship: %w", err)
		}
	}
	var conversation entity.Conversation
	err := tx.Table("conversations AS c").Select("c.*").Joins("JOIN conversation_members AS a ON a.conversation_id = c.id AND a.user_id = ?", first).Joins("JOIN conversation_members AS b ON b.conversation_id = c.id AND b.user_id = ?", second).Where("c.conversation_type = ?", "direct").Order("c.id ASC").Limit(1).Take(&conversation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		conversation = entity.Conversation{ConversationType: "direct", CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&conversation).Error; err != nil {
			return fmt.Errorf("create direct conversation: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("find direct conversation: %w", err)
	}
	for _, userID := range []uint64{first, second} {
		member := entity.ConversationMember{ConversationID: conversation.ID, UserID: userID, MemberState: "active", JoinedAt: now}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "conversation_id"}, {Name: "user_id"}}, DoUpdates: clause.Assignments(map[string]interface{}{"member_state": "active", "left_at": nil})}).Create(&member).Error; err != nil {
			return fmt.Errorf("ensure conversation member: %w", err)
		}
		cursor := entity.ConversationMemberCursor{ConversationID: conversation.ID, UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&cursor).Error; err != nil {
			return fmt.Errorf("ensure conversation cursor: %w", err)
		}
	}
	return nil
}
