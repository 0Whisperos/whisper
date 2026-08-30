package app

import (
	"fmt"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"golang.org/x/crypto/bcrypt"
)

var (
	findSeedUserByAccount              = mysql.FindUserByAccount
	createSeedUser                     = mysql.CreateUser
	createSeedFriendship               = mysql.CreateFriendship
	createSeedConversation             = mysql.CreateConversation
	createSeedConversationMember       = mysql.CreateConversationMember
	createSeedConversationMemberCursor = mysql.CreateConversationMemberCursor
)

func RunSeed(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}

	if err := mysql.Open(cfg.Database); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := mysql.Close(); err != nil {
			logging.Error("close database after seed", "error", err)
		}
	}()

	if err := seedData(cfg.Seed); err != nil {
		return err
	}

	logging.Info("seed data created")
	return nil
}

func seedData(seed config.SeedConfig) error {
	if len(seed.Users) != 2 {
		return fmt.Errorf("seed users must contain exactly two users")
	}

	first, err := handleAccount(seed.Users[0])
	if err != nil {
		return err
	}
	second, err := handleAccount(seed.Users[1])
	if err != nil {
		return err
	}

	return createSeedChatBase(first, second)
}

func handleAccount(seedUser config.SeedUserConfig) (entity.User, error) {
	if err := auth.ValidateCredentials(seedUser.Account, seedUser.Password); err != nil {
		return entity.User{}, fmt.Errorf("validate seed user %q: %w", seedUser.Account, err)
	}

	user, found, err := findSeedUserByAccount(seedUser.Account)
	if err != nil {
		return entity.User{}, fmt.Errorf("find seed user: %w", err)
	}
	if found {
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(seedUser.Password)); err != nil {
			return entity.User{}, fmt.Errorf("seed password mismatch: %w", err)
		}

		return user, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(seedUser.Password), bcrypt.DefaultCost)
	if err != nil {
		return entity.User{}, fmt.Errorf("hash seed password: %w", err)
	}
	user = entity.User{
		Account:      seedUser.Account,
		PasswordHash: string(hash),
		Nickname:     seedUser.Nickname,
		Signature:    seedUser.Signature,
	}
	if err := createSeedUser(&user); err != nil {
		return entity.User{}, fmt.Errorf("create seed user: %w", err)
	}

	return user, nil
}

func createSeedChatBase(first entity.User, second entity.User) error {
	now := time.Now()
	if err := createSeedFriendship(seedFriendship(first.ID, second.ID, now)); err != nil {
		return err
	}
	if err := createSeedFriendship(seedFriendship(second.ID, first.ID, now)); err != nil {
		return err
	}

	conversation := entity.Conversation{
		ConversationType: "direct",
		LastSeq:          0,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := createSeedConversation(&conversation); err != nil {
		return err
	}

	for _, userID := range []uint64{first.ID, second.ID} {
		member := entity.ConversationMember{
			ConversationID: conversation.ID,
			UserID:         userID,
			MemberState:    "active",
			JoinedAt:       now,
		}
		if err := createSeedConversationMember(member); err != nil {
			return err
		}

		cursor := entity.ConversationMemberCursor{
			ConversationID: conversation.ID,
			UserID:         userID,
			DeliveredSeq:   0,
			ReadSeq:        0,
		}
		if err := createSeedConversationMemberCursor(cursor); err != nil {
			return err
		}
	}

	return nil
}

func seedFriendship(userID uint64, friendUserID uint64, now time.Time) entity.Friendship {
	return entity.Friendship{
		UserID:          userID,
		FriendUserID:    friendUserID,
		FriendshipState: "active",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}
