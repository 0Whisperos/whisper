package chat

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
)

const (
	DefaultMessagePageSize = 50
	MaxMessagePageSize     = 100
)

type Friend struct {
	User            entity.User
	FriendshipState string
	ConversationID  *uint64
}

type MessagePage struct {
	Messages      []entity.Message
	HasMore       bool
	NextBeforeSeq *uint64
	NextFromSeq   *uint64
}

var (
	findUserByID               = mysql.FindUserByID
	listActiveFriendships      = mysql.ListActiveFriendships
	findDirectConversationID   = mysql.FindDirectConversationID
	findConversationByID       = mysql.FindConversationByID
	isActiveConversationMember = mysql.IsActiveConversationMember
	listMessages               = mysql.ListMessages
)

func GetUser(userID uint64) (entity.User, error) {
	user, found, err := findUserByID(userID)
	if err != nil {
		return entity.User{}, fmt.Errorf("get user: %w", err)
	}
	if !found {
		return entity.User{}, ErrUserNotFound
	}
	return user, nil
}

func ListFriends(userID uint64) ([]Friend, error) {
	friendships, err := listActiveFriendships(userID)
	if err != nil {
		return nil, fmt.Errorf("list friends: %w", err)
	}

	friends := make([]Friend, 0, len(friendships))
	for _, friendship := range friendships {
		user, found, err := findUserByID(friendship.FriendUserID)
		if err != nil {
			return nil, fmt.Errorf("load friend profile: %w", err)
		}
		if !found {
			return nil, fmt.Errorf("load friend profile: %w", ErrUserNotFound)
		}

		conversationID, found, err := findDirectConversationID(userID, friendship.FriendUserID)
		if err != nil {
			return nil, fmt.Errorf("load friend conversation: %w", err)
		}
		if !found {
			conversationID = nil
		}

		friends = append(friends, Friend{
			User:            user,
			FriendshipState: friendship.FriendshipState,
			ConversationID:  conversationID,
		})
	}

	return friends, nil
}

func ListConversationMessages(userID, conversationID uint64, beforeSeq, fromSeq *uint64, limit int) (MessagePage, error) {
	if beforeSeq != nil && fromSeq != nil {
		return MessagePage{}, ErrInvalidPagination
	}
	if limit == 0 {
		limit = DefaultMessagePageSize
	}
	if limit < 1 || limit > MaxMessagePageSize {
		return MessagePage{}, ErrInvalidPagination
	}

	conversation, found, err := findConversationByID(conversationID)
	if err != nil {
		return MessagePage{}, fmt.Errorf("find conversation: %w", err)
	}
	if !found || conversation.ConversationType != "direct" {
		return MessagePage{}, ErrConversationNotFound
	}
	member, err := isActiveConversationMember(conversationID, userID)
	if err != nil {
		return MessagePage{}, fmt.Errorf("check conversation membership: %w", err)
	}
	if !member {
		return MessagePage{}, ErrNotConversationMember
	}

	messages, hasMore, err := listMessages(conversationID, beforeSeq, fromSeq, limit)
	if err != nil {
		return MessagePage{}, fmt.Errorf("load conversation messages: %w", err)
	}

	page := MessagePage{Messages: messages, HasMore: hasMore}
	if hasMore && len(messages) > 0 {
		if fromSeq != nil {
			nextFromSeq := messages[len(messages)-1].ConversationSeq + 1
			page.NextFromSeq = &nextFromSeq
		} else {
			nextBeforeSeq := messages[0].ConversationSeq
			page.NextBeforeSeq = &nextBeforeSeq
		}
	}
	return page, nil
}
