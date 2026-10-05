//go:build cgo

package mysql

import (
	"errors"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupFriendRequestDB(t *testing.T) {
	t.Helper()
	previous := global.MysqlDB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite test database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sqlite database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	global.MysqlDB = db
	t.Cleanup(func() { global.MysqlDB = previous; _ = sqlDB.Close() })
	if err := db.AutoMigrate(migrationModels()...); err != nil {
		t.Fatalf("migrate friend request test schema: %v", err)
	}
	for _, user := range []entity.User{{ID: 1, Account: "00100001", PasswordHash: "x"}, {ID: 2, Account: "00100002", PasswordHash: "x"}} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatalf("create test user %d: %v", user.ID, err)
		}
	}
}

func TestCreateOrRefreshMutualRequestsAcceptsAndCreatesConversationAtomically(t *testing.T) {
	// 测试目标：验证反向待处理申请在事务中同时通过，并完整创建双向好友关系和直聊基础数据。
	// 构造方法：在临时 SQLite 数据库迁移正式实体表，插入两个用户并依次创建相反方向申请。
	// 输入数据：用户 1 -> 2 和用户 2 -> 1 两条待处理申请。
	// 预期行为：两条申请均 accepted，生成两条 active friendship、一条 direct conversation、两个成员和两个游标。
	setupFriendRequestDB(t)
	first := entity.FriendRequest{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "A"}
	if accepted, err := CreateOrRefreshFriendRequest(&first); err != nil || accepted {
		t.Fatalf("first create = accepted %v, error %v", accepted, err)
	}
	second := entity.FriendRequest{SenderUserID: 2, RecipientUserID: 1, VerificationMessage: "B"}
	if accepted, err := CreateOrRefreshFriendRequest(&second); err != nil || !accepted {
		t.Fatalf("reverse create = accepted %v, error %v", accepted, err)
	}
	var requests []entity.FriendRequest
	if err := global.MysqlDB.Order("id").Find(&requests).Error; err != nil {
		t.Fatalf("load friend requests: %v", err)
	}
	if len(requests) != 2 || requests[0].Status != "accepted" || requests[1].Status != "accepted" {
		t.Fatalf("request statuses = %#v, want both accepted", requests)
	}
	if _, err := DecideFriendRequest(first.ID, 2, true); !errors.Is(err, ErrFriendRequestNotPending) {
		t.Fatalf("decide already accepted request error = %v, want ErrFriendRequestNotPending", err)
	}
	var friendships []entity.Friendship
	if err := global.MysqlDB.Order("user_id").Find(&friendships).Error; err != nil {
		t.Fatalf("load friendships: %v", err)
	}
	if len(friendships) != 2 || friendships[0].FriendshipState != "active" || friendships[1].FriendshipState != "active" {
		t.Fatalf("friendships = %#v, want two active directions", friendships)
	}
	var conversationCount, memberCount, cursorCount int64
	global.MysqlDB.Model(&entity.Conversation{}).Where("conversation_type = ?", "direct").Count(&conversationCount)
	global.MysqlDB.Model(&entity.ConversationMember{}).Where("member_state = ?", "active").Count(&memberCount)
	global.MysqlDB.Model(&entity.ConversationMemberCursor{}).Count(&cursorCount)
	if conversationCount != 1 || memberCount != 2 || cursorCount != 2 {
		t.Fatalf("conversation/member/cursor counts = %d/%d/%d, want 1/2/2", conversationCount, memberCount, cursorCount)
	}
}

func TestPendingDuplicateIsStableAndRejectedRequestCanBeResent(t *testing.T) {
	// 测试目标：验证重复 pending 请求不改内容或时间，拒绝后重发复用方向记录并重置本轮时间。
	// 构造方法：创建一条申请，将其创建时间回拨一天，再重发、拒绝并再次重发。
	// 输入数据：同一方向 1 -> 2 首次消息 old、重复消息 ignored、拒绝后新消息 retry。
	// 预期行为：pending 重复返回 ErrFriendRequestAlreadyPending 且原消息不变；重发后同 ID 变 pending 并保留新消息与新时间。
	setupFriendRequestDB(t)
	request := entity.FriendRequest{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "old"}
	if _, err := CreateOrRefreshFriendRequest(&request); err != nil {
		t.Fatalf("create first request: %v", err)
	}
	oldCreatedAt := time.Now().Add(-24 * time.Hour)
	if err := global.MysqlDB.Model(&entity.FriendRequest{}).Where("id = ?", request.ID).Update("created_at", oldCreatedAt).Error; err != nil {
		t.Fatalf("set original request time: %v", err)
	}
	duplicate := entity.FriendRequest{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "ignored"}
	if _, err := CreateOrRefreshFriendRequest(&duplicate); !errors.Is(err, ErrFriendRequestAlreadyPending) {
		t.Fatalf("duplicate request error = %v, want ErrFriendRequestAlreadyPending", err)
	}
	var unchanged entity.FriendRequest
	if err := global.MysqlDB.First(&unchanged, request.ID).Error; err != nil {
		t.Fatalf("reload unchanged request: %v", err)
	}
	if unchanged.VerificationMessage != "old" || unchanged.CreatedAt.After(time.Now().Add(-23*time.Hour)) {
		t.Fatalf("duplicate changed current request: %#v", unchanged)
	}
	if _, err := DecideFriendRequest(request.ID, 2, false); err != nil {
		t.Fatalf("reject request: %v", err)
	}
	retry := entity.FriendRequest{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "retry"}
	if accepted, err := CreateOrRefreshFriendRequest(&retry); err != nil || accepted {
		t.Fatalf("retry create = accepted %v, error %v", accepted, err)
	}
	if retry.ID != request.ID || retry.Status != "pending" || retry.VerificationMessage != "retry" || !retry.CreatedAt.After(oldCreatedAt) {
		t.Fatalf("retried request = %#v, want same id, pending, new message and time", retry)
	}
}

func TestListFriendRequestsSortsCursorAndCountsAllIncomingPending(t *testing.T) {
	// 测试目标：验证列表按 CreatedAt/id 倒序使用复合游标，并且任一 direction 都返回完整入站待处理数。
	// 构造方法：插入三条发给用户 2 的申请和一条由用户 2 发出的申请，随后查询第一页、第二页和 outgoing。
	// 输入数据：入站申请按时间分别为 1h、2h、3h 前，状态 pending、accepted、pending；每页两条。
	// 预期行为：第一页 ID 为 1、2 且 has_more=true；游标页仅 ID=3；outgoing pending_count 仍为 2。
	setupFriendRequestDB(t)
	now := time.Now().UTC()
	rows := []entity.FriendRequest{
		{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "newest", Status: "pending", CreatedAt: now.Add(-time.Hour), UpdatedAt: now},
		{SenderUserID: 2, RecipientUserID: 1, VerificationMessage: "outgoing", Status: "pending", CreatedAt: now.Add(-90 * time.Minute), UpdatedAt: now},
		{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "middle", Status: "accepted", CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now},
		{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "oldest", Status: "pending", CreatedAt: now.Add(-3 * time.Hour), UpdatedAt: now},
	}
	for i := range rows {
		if err := global.MysqlDB.Create(&rows[i]).Error; err != nil {
			t.Fatalf("create request fixture %d: %v", i, err)
		}
	}
	first, pendingCount, hasMore, err := ListFriendRequests(2, "incoming", nil, 0, 2)
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if len(first) != 2 || first[0].ID != rows[0].ID || first[1].ID != rows[2].ID || pendingCount != 2 || !hasMore {
		t.Fatalf("first page/count/has_more = %#v/%d/%v", first, pendingCount, hasMore)
	}
	second, secondPendingCount, secondHasMore, err := ListFriendRequests(2, "incoming", &first[len(first)-1].CreatedAt, first[len(first)-1].ID, 2)
	if err != nil {
		t.Fatalf("list cursor page: %v", err)
	}
	if len(second) != 1 || second[0].ID != rows[3].ID || secondPendingCount != 2 || secondHasMore {
		t.Fatalf("second page/count/has_more = %#v/%d/%v", second, secondPendingCount, secondHasMore)
	}
	outgoing, outgoingPendingCount, outgoingHasMore, err := ListFriendRequests(2, "outgoing", nil, 0, 2)
	if err != nil {
		t.Fatalf("list outgoing page: %v", err)
	}
	if len(outgoing) != 1 || outgoing[0].ID != rows[1].ID || outgoingPendingCount != 2 || outgoingHasMore {
		t.Fatalf("outgoing/count/has_more = %#v/%d/%v", outgoing, outgoingPendingCount, outgoingHasMore)
	}
}

func TestAcceptReactivatesExistingDirectConversation(t *testing.T) {
	// 测试目标：验证曾离开好友关系的双方重新成为好友时沿用已有 direct conversation。
	// 构造方法：预建一条双方成员均 inactive 的直聊和一条入站 pending 申请，再执行 accept。
	// 输入数据：会话 ID=1，成员 1、2 均 inactive，用户 1 向用户 2 申请好友。
	// 预期行为：接受后仍只有原会话，两个成员变为 active，且两个成员游标均存在。
	setupFriendRequestDB(t)
	conversation := entity.Conversation{ConversationType: "direct", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := global.MysqlDB.Create(&conversation).Error; err != nil {
		t.Fatalf("create former direct conversation: %v", err)
	}
	for _, userID := range []uint64{1, 2} {
		member := entity.ConversationMember{ConversationID: conversation.ID, UserID: userID, MemberState: "inactive", JoinedAt: time.Now()}
		if err := global.MysqlDB.Create(&member).Error; err != nil {
			t.Fatalf("create inactive member %d: %v", userID, err)
		}
	}
	request := entity.FriendRequest{SenderUserID: 1, RecipientUserID: 2, VerificationMessage: "reconnect", Status: "pending", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := global.MysqlDB.Create(&request).Error; err != nil {
		t.Fatalf("create pending request: %v", err)
	}
	if _, err := DecideFriendRequest(request.ID, 2, true); err != nil {
		t.Fatalf("accept request: %v", err)
	}
	var conversations int64
	if err := global.MysqlDB.Model(&entity.Conversation{}).Where("conversation_type = ?", "direct").Count(&conversations).Error; err != nil {
		t.Fatalf("count direct conversations: %v", err)
	}
	var activeMembers, cursors int64
	if err := global.MysqlDB.Model(&entity.ConversationMember{}).Where("conversation_id = ? AND member_state = ?", conversation.ID, "active").Count(&activeMembers).Error; err != nil {
		t.Fatalf("count active members: %v", err)
	}
	if err := global.MysqlDB.Model(&entity.ConversationMemberCursor{}).Where("conversation_id = ?", conversation.ID).Count(&cursors).Error; err != nil {
		t.Fatalf("count cursors: %v", err)
	}
	if conversations != 1 || activeMembers != 2 || cursors != 2 {
		t.Fatalf("conversation/active member/cursor counts = %d/%d/%d, want 1/2/2", conversations, activeMembers, cursors)
	}
}
