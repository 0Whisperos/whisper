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
	// Test goal: verify an authorized forward history page returns the current and peer receipt cursors with the messages.
	// Construction: stub direct conversation lookup, active membership, message listing, and both existing member cursor rows.
	// Input: user_id=20001, conversation_id=30001, last_seq=12, from_seq=10, limit=2, self cursors 9/8, and peer cursors 11/10.
	// Expected behavior: the page returns last_seq=12, next_from_seq=12, has_more=true, and all four member cursor values unchanged.
	oldFindConversation := findConversationByID
	oldMember := isActiveConversationMember
	oldListMessages := listMessages
	oldFindCursors := findConversationCursors
	t.Cleanup(func() {
		findConversationByID = oldFindConversation
		isActiveConversationMember = oldMember
		listMessages = oldListMessages
		findConversationCursors = oldFindCursors
	})
	findConversationByID = func(uint64) (entity.Conversation, bool, error) {
		return entity.Conversation{ID: 30001, ConversationType: "direct", LastSeq: 12}, true, nil
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
	findConversationCursors = func(conversationID, userID uint64) (entity.ConversationMemberCursor, entity.ConversationMemberCursor, error) {
		if conversationID != 30001 || userID != 20001 {
			t.Fatalf("cursor lookup = conversation %d, user %d; want 30001, 20001", conversationID, userID)
		}
		return entity.ConversationMemberCursor{UserID: 20001, DeliveredSeq: 9, ReadSeq: 8}, entity.ConversationMemberCursor{UserID: 20002, DeliveredSeq: 11, ReadSeq: 10}, nil
	}
	fromSeq := uint64(10)

	page, err := ListConversationMessages(20001, 30001, nil, &fromSeq, 2)
	if err != nil {
		t.Fatalf("ListConversationMessages returned an error: %v", err)
	}
	if !page.HasMore || page.NextFromSeq == nil || *page.NextFromSeq != 12 || len(page.Messages) != 2 {
		t.Fatalf("page = %#v, want has_more and next_from_seq=12", page)
	}
	if page.LastSeq != 12 || page.DeliveredSeq != 9 || page.ReadSeq != 8 || page.PeerDeliveredSeq != 11 || page.PeerReadSeq != 10 {
		t.Fatalf("page cursors = last %d, delivered/read %d/%d, peer delivered/read %d/%d; want 12 and 9/8 and 11/10", page.LastSeq, page.DeliveredSeq, page.ReadSeq, page.PeerDeliveredSeq, page.PeerReadSeq)
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
