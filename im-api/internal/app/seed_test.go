package app

import (
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func TestSeedDataCreatesUsersFriendshipsAndDirectConversationBase(t *testing.T) {
	// Goal: verify seedData creates two users, bidirectional friendships and direct conversation base data.
	// Setup: replace package-level MySQL functions with stubs that record created entities and assign test IDs.
	// Input: seed.users contains 00100001/password and 00100002/password.
	// Expected: two users, two active friendships, one direct conversation, two active members and two zero cursors are created.
	restoreSeedStubs := stubSeedRepositories(t)
	defer restoreSeedStubs()

	err := seedData(config.SeedConfig{
		Users: []config.SeedUserConfig{
			{Account: "00100001", Password: "password"},
			{Account: "00100002", Password: "password"},
		},
	})

	if err != nil {
		t.Fatalf("seedData returned an error: %v", err)
	}
	if len(seedStubState.createdUsers) != 2 {
		t.Fatalf("created users = %#v, want two users", seedStubState.createdUsers)
	}
	if seedStubState.createdUsers[0].Account != "00100001" || seedStubState.createdUsers[1].Account != "00100002" {
		t.Fatalf("created users = %#v, want configured accounts", seedStubState.createdUsers)
	}
	if len(seedStubState.friendships) != 2 {
		t.Fatalf("friendships = %#v, want two directional rows", seedStubState.friendships)
	}
	assertFriendship(t, seedStubState.friendships[0], 1, 2)
	assertFriendship(t, seedStubState.friendships[1], 2, 1)
	if len(seedStubState.conversations) != 1 {
		t.Fatalf("conversations = %#v, want one conversation", seedStubState.conversations)
	}
	if seedStubState.conversations[0].ID != 10001 || seedStubState.conversations[0].ConversationType != "direct" {
		t.Fatalf("conversation = %#v, want direct conversation with assigned ID", seedStubState.conversations[0])
	}
	if len(seedStubState.members) != 2 {
		t.Fatalf("members = %#v, want two conversation members", seedStubState.members)
	}
	assertMember(t, seedStubState.members[0], 10001, 1)
	assertMember(t, seedStubState.members[1], 10001, 2)
	if len(seedStubState.cursors) != 2 {
		t.Fatalf("cursors = %#v, want two member cursors", seedStubState.cursors)
	}
	assertCursor(t, seedStubState.cursors[0], 10001, 1)
	assertCursor(t, seedStubState.cursors[1], 10001, 2)
}

var seedStubState struct {
	nextUserID    uint64
	usersByAcct   map[string]entity.User
	createdUsers  []entity.User
	friendships   []entity.Friendship
	conversations []entity.Conversation
	members       []entity.ConversationMember
	cursors       []entity.ConversationMemberCursor
}

func stubSeedRepositories(t *testing.T) func() {
	t.Helper()

	oldFindUserByAccount := findSeedUserByAccount
	oldCreateUser := createSeedUser
	oldCreateFriendship := createSeedFriendship
	oldCreateConversation := createSeedConversation
	oldCreateConversationMember := createSeedConversationMember
	oldCreateConversationMemberCursor := createSeedConversationMemberCursor

	seedStubState.nextUserID = 1
	seedStubState.usersByAcct = map[string]entity.User{}
	seedStubState.createdUsers = nil
	seedStubState.friendships = nil
	seedStubState.conversations = nil
	seedStubState.members = nil
	seedStubState.cursors = nil

	findSeedUserByAccount = func(account string) (entity.User, bool, error) {
		user, found := seedStubState.usersByAcct[account]
		return user, found, nil
	}
	createSeedUser = func(user *entity.User) error {
		user.ID = seedStubState.nextUserID
		seedStubState.nextUserID++
		seedStubState.usersByAcct[user.Account] = *user
		seedStubState.createdUsers = append(seedStubState.createdUsers, *user)
		return nil
	}
	createSeedFriendship = func(friendship entity.Friendship) error {
		seedStubState.friendships = append(seedStubState.friendships, friendship)
		return nil
	}
	createSeedConversation = func(conversation *entity.Conversation) error {
		conversation.ID = 10001
		seedStubState.conversations = append(seedStubState.conversations, *conversation)
		return nil
	}
	createSeedConversationMember = func(member entity.ConversationMember) error {
		seedStubState.members = append(seedStubState.members, member)
		return nil
	}
	createSeedConversationMemberCursor = func(cursor entity.ConversationMemberCursor) error {
		seedStubState.cursors = append(seedStubState.cursors, cursor)
		return nil
	}

	return func() {
		findSeedUserByAccount = oldFindUserByAccount
		createSeedUser = oldCreateUser
		createSeedFriendship = oldCreateFriendship
		createSeedConversation = oldCreateConversation
		createSeedConversationMember = oldCreateConversationMember
		createSeedConversationMemberCursor = oldCreateConversationMemberCursor
	}
}

func assertFriendship(t *testing.T, friendship entity.Friendship, userID uint64, friendUserID uint64) {
	t.Helper()

	if friendship.UserID != userID || friendship.FriendUserID != friendUserID || friendship.FriendshipState != "active" {
		t.Fatalf("friendship = %#v, want %d -> %d active", friendship, userID, friendUserID)
	}
}

func assertMember(t *testing.T, member entity.ConversationMember, conversationID uint64, userID uint64) {
	t.Helper()

	if member.ConversationID != conversationID || member.UserID != userID || member.MemberState != "active" {
		t.Fatalf("member = %#v, want active user %d in conversation %d", member, userID, conversationID)
	}
}

func assertCursor(t *testing.T, cursor entity.ConversationMemberCursor, conversationID uint64, userID uint64) {
	t.Helper()

	if cursor.ConversationID != conversationID || cursor.UserID != userID || cursor.DeliveredSeq != 0 || cursor.ReadSeq != 0 {
		t.Fatalf("cursor = %#v, want zero cursor for user %d in conversation %d", cursor, userID, conversationID)
	}
}
