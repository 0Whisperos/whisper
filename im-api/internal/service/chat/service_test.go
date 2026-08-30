package chat

import (
	"errors"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestGetUserReturnsProfileForExistingUser(t *testing.T) {
	// Test goal: verify the chat service returns the requested user profile when the repository finds it.
	// Construction: replace the user repository function with a stub that records the requested ID and returns a user.
	// Input: user_id=20001 and a user with account 00100001, nickname Alice, and signature Hello.
	// Expected behavior: GetUser returns the same user and the repository receives user_id=20001.
	oldFindUserByID := findUserByID
	t.Cleanup(func() { findUserByID = oldFindUserByID })
	var requestedID uint64
	findUserByID = func(userID uint64) (entity.User, bool, error) {
		requestedID = userID
		return entity.User{ID: userID, Account: "00100001", Nickname: "Alice", Signature: "Hello"}, true, nil
	}

	user, err := GetUser(20001)
	if err != nil {
		t.Fatalf("GetUser returned an error: %v", err)
	}
	if requestedID != 20001 || user.Nickname != "Alice" || user.Signature != "Hello" {
		t.Fatalf("GetUser returned %#v for requested ID %d", user, requestedID)
	}
}

func TestListFriendsLoadsOnlyRepositoryActiveFriendshipsWithConversations(t *testing.T) {
	// Test goal: verify friend results combine friendship rows, friend profiles, and optional direct conversation IDs.
	// Construction: stub all repository functions and return one active friendship, one profile, and one direct conversation.
	// Input: current user_id=20001, friend_user_id=20002, friendship_state=active, conversation_id=30001.
	// Expected behavior: the result contains the friend profile, active state, and conversation_id=30001.
	oldList := listActiveFriendships
	oldFindUser := findUserByID
	oldFindConversation := findDirectConversationID
	t.Cleanup(func() {
		listActiveFriendships = oldList
		findUserByID = oldFindUser
		findDirectConversationID = oldFindConversation
	})
	listActiveFriendships = func(userID uint64) ([]entity.Friendship, error) {
		if userID != 20001 {
			t.Fatalf("listActiveFriendships user_id = %d, want 20001", userID)
		}
		return []entity.Friendship{{UserID: 20001, FriendUserID: 20002, FriendshipState: "active"}}, nil
	}
	findUserByID = func(userID uint64) (entity.User, bool, error) {
		return entity.User{ID: userID, Account: "00100002", Nickname: "Bob"}, true, nil
	}
	findDirectConversationID = func(userID, friendUserID uint64) (*uint64, bool, error) {
		conversationID := uint64(30001)
		return &conversationID, true, nil
	}

	friends, err := ListFriends(20001)
	if err != nil {
		t.Fatalf("ListFriends returned an error: %v", err)
	}
	if len(friends) != 1 || friends[0].User.ID != 20002 || friends[0].ConversationID == nil || *friends[0].ConversationID != 30001 {
		t.Fatalf("friends = %#v, want one friend with conversation 30001", friends)
	}
}

func TestListConversationMessagesRejectsInvalidCursorCombination(t *testing.T) {
	// Test goal: verify the history service rejects requests that provide both backward and forward cursors.
	// Construction: create before_seq=5 and from_seq=6 and call the service without repository access.
	// Input: conversation_id=30001, user_id=20001, before_seq=5, from_seq=6, limit=50.
	// Expected behavior: the service returns ErrInvalidPagination immediately.
	beforeSeq, fromSeq := uint64(5), uint64(6)
	_, err := ListConversationMessages(20001, 30001, &beforeSeq, &fromSeq, 50)
	if !errors.Is(err, ErrInvalidPagination) {
		t.Fatalf("error = %v, want ErrInvalidPagination", err)
	}
}

func TestListConversationMessagesReturnsPageAndNextForwardCursor(t *testing.T) {
	// Test goal: verify an authorized forward history request returns ordered messages and advances the cursor.
	// Construction: stub conversation lookup, membership lookup, and message listing with two messages and hasMore=true.
	// Input: user_id=20001, conversation_id=30001, from_seq=10, limit=2.
	// Expected behavior: the page preserves the messages and returns next_from_seq=12 with has_more=true.
	oldFindConversation := findConversationByID
	oldMember := isActiveConversationMember
	oldListMessages := listMessages
	t.Cleanup(func() {
		findConversationByID = oldFindConversation
		isActiveConversationMember = oldMember
		listMessages = oldListMessages
	})
	findConversationByID = func(uint64) (entity.Conversation, bool, error) {
		return entity.Conversation{ID: 30001, ConversationType: "direct"}, true, nil
	}
	isActiveConversationMember = func(conversationID, userID uint64) (bool, error) {
		return conversationID == 30001 && userID == 20001, nil
	}
	listMessages = func(conversationID uint64, beforeSeq, fromSeq *uint64, limit int) ([]entity.Message, bool, error) {
		if conversationID != 30001 || fromSeq == nil || *fromSeq != 10 || beforeSeq != nil || limit != 2 {
			t.Fatalf("unexpected list request: conversation=%d before=%v from=%v limit=%d", conversationID, beforeSeq, fromSeq, limit)
		}
		return []entity.Message{{ConversationSeq: 10}, {ConversationSeq: 11}}, true, nil
	}
	fromSeq := uint64(10)

	page, err := ListConversationMessages(20001, 30001, nil, &fromSeq, 2)
	if err != nil {
		t.Fatalf("ListConversationMessages returned an error: %v", err)
	}
	if !page.HasMore || page.NextFromSeq == nil || *page.NextFromSeq != 12 || len(page.Messages) != 2 {
		t.Fatalf("page = %#v, want has_more and next_from_seq=12", page)
	}
}

func TestListConversationMessagesDistinguishesMissingConversationAndMember(t *testing.T) {
	// Test goal: verify the service exposes separate errors for a missing conversation and an unauthorized member.
	// Construction: first stub conversation lookup as missing, then as existing with membership=false.
	// Input: user_id=20001 and conversation_id=30001.
	// Expected behavior: the two calls return ErrConversationNotFound and ErrNotConversationMember respectively.
	oldFindConversation := findConversationByID
	oldMember := isActiveConversationMember
	t.Cleanup(func() {
		findConversationByID = oldFindConversation
		isActiveConversationMember = oldMember
	})
	findConversationByID = func(uint64) (entity.Conversation, bool, error) { return entity.Conversation{}, false, nil }
	if _, err := ListConversationMessages(20001, 30001, nil, nil, 50); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("missing conversation error = %v, want ErrConversationNotFound", err)
	}

	findConversationByID = func(uint64) (entity.Conversation, bool, error) {
		return entity.Conversation{ID: 30001, ConversationType: "direct"}, true, nil
	}
	isActiveConversationMember = func(uint64, uint64) (bool, error) { return false, nil }
	if _, err := ListConversationMessages(20001, 30001, nil, nil, 50); !errors.Is(err, ErrNotConversationMember) {
		t.Fatalf("non-member error = %v, want ErrNotConversationMember", err)
	}
}
