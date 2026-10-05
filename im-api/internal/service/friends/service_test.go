package friends

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
)

func TestCreateValidatesAndTrimsRequestData(t *testing.T) {
	// 测试目标：验证请求验证信息会 TrimSpace，200 个 Unicode rune 可发送，201 个 rune 会被拒绝。
	// 构造方法：替换查找用户、好友列表、创建申请和通知边界，并在测试结束时恢复。
	// 输入数据：账号 00100002，带首尾空格的 200 个“好”字，以及超长的 201 个“好”字。
	// 预期行为：合法请求仅保存去空白后的 200 rune 文本；超长请求返回 ErrInvalidRequest 且不进入 repository。
	oldAccount, oldID, oldFriends, oldCreate, oldNotify := findUserByAccount, findUserByID, listActiveFriendships, createRequest, notifyRequest
	t.Cleanup(func() {
		findUserByAccount, findUserByID, listActiveFriendships, createRequest, notifyRequest = oldAccount, oldID, oldFriends, oldCreate, oldNotify
	})
	findUserByAccount = func(account string) (entity.User, bool, error) {
		return entity.User{ID: 2, Account: account}, true, nil
	}
	findUserByID = func(id uint64) (entity.User, bool, error) { return entity.User{ID: id}, true, nil }
	listActiveFriendships = func(uint64) ([]entity.Friendship, error) { return nil, nil }
	calls := 0
	createRequest = func(request *entity.FriendRequest) (bool, error) {
		calls++
		request.ID = 4
		request.Status = "pending"
		return false, nil
	}
	notifyRequest = func(string, uint64, uint64, string) error { return nil }
	result, err := Create(1, "00100002", "  "+strings.Repeat("好", 200)+"  ", "secret")
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if got := utf8.RuneCountInString(result.Request.VerificationMessage); got != 200 {
		t.Fatalf("verification rune count = %d, want 200", got)
	}
	_, err = Create(1, "00100002", strings.Repeat("好", 201), "secret")
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("overlong verification error = %v, want ErrInvalidRequest", err)
	}
	if calls != 1 {
		t.Fatalf("repository create calls = %d, want 1", calls)
	}
}

func TestCreateRejectsSelfAndDuplicatePending(t *testing.T) {
	// 测试目标：验证不能给自己发送申请，并将同方向重复待处理申请映射为稳定冲突。
	// 构造方法：替换用户查询与好友列表；让 repository 返回已存在 pending 哨兵。
	// 输入数据：先使用当前用户自己的账号，再使用另一个账号重复发送。
	// 预期行为：自己请求返回 ErrSelfRequest，重复请求返回 ErrRequestPending，且不会静默刷新记录。
	oldAccount, oldID, oldFriends, oldCreate := findUserByAccount, findUserByID, listActiveFriendships, createRequest
	t.Cleanup(func() {
		findUserByAccount, findUserByID, listActiveFriendships, createRequest = oldAccount, oldID, oldFriends, oldCreate
	})
	findUserByAccount = func(account string) (entity.User, bool, error) {
		if account == "00100001" {
			return entity.User{ID: 1, Account: account}, true, nil
		}
		return entity.User{ID: 2, Account: account}, true, nil
	}
	findUserByID = func(id uint64) (entity.User, bool, error) { return entity.User{ID: id}, true, nil }
	listActiveFriendships = func(uint64) ([]entity.Friendship, error) { return nil, nil }
	createRequest = func(*entity.FriendRequest) (bool, error) { return false, mysql.ErrFriendRequestAlreadyPending }
	if _, err := Create(1, "00100001", "", "secret"); !errors.Is(err, ErrSelfRequest) {
		t.Fatalf("self request error = %v, want ErrSelfRequest", err)
	}
	if _, err := Create(1, "00100002", "", "secret"); !errors.Is(err, ErrRequestPending) {
		t.Fatalf("duplicate pending error = %v, want ErrRequestPending", err)
	}
}

func TestSearchByAccountValidatesAndReturnsPublicUser(t *testing.T) {
	// 测试目标：验证账号查找只接受 8 到 12 位数字，并区分找到用户与无结果。
	// 构造方法：stub 按账号命中一个公开资料用户，再让同一查询函数返回未找到。
	// 输入数据：有效账号 00100002、非法账号 001-2 和不存在账号 00100003。
	// 预期行为：有效账号返回对应用户，格式错误返回 ErrInvalidRequest，不存在账号返回 ErrUserNotFound。
	oldAccount := findUserByAccount
	t.Cleanup(func() { findUserByAccount = oldAccount })
	findUserByAccount = func(account string) (entity.User, bool, error) {
		if account == "00100002" {
			return entity.User{ID: 2, Account: account, Nickname: "B"}, true, nil
		}
		return entity.User{}, false, nil
	}
	user, err := SearchByAccount("00100002")
	if err != nil || user.ID != 2 || user.Nickname != "B" {
		t.Fatalf("SearchByAccount result = %#v, %v", user, err)
	}
	if _, err := SearchByAccount("001-2"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid account error = %v", err)
	}
	if _, err := SearchByAccount("00100003"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("missing account error = %v", err)
	}
}

func TestCreateMutualPendingRequestNotifiesPeerAsAccepted(t *testing.T) {
	// 测试目标：验证创建反向申请时会自动合并互相待处理状态，并通知对端刷新已通过的申请。
	// 构造方法：stub 两个用户查询、空好友集、原子仓储返回 autoAccepted，并提供对端原申请 ID。
	// 输入数据：当前用户 1 向用户 2 创建申请，双方申请 ID 分别为 50 和 40。
	// 预期行为：HTTP 服务结果为 accepted，且只向对端用户 2 推送其申请 ID=40、status=accepted。
	oldAccount, oldID, oldFriends, oldCreate, oldFindRequest, oldNotify := findUserByAccount, findUserByID, listActiveFriendships, createRequest, findFriendRequestID, notifyRequest
	t.Cleanup(func() {
		findUserByAccount, findUserByID, listActiveFriendships, createRequest, findFriendRequestID, notifyRequest = oldAccount, oldID, oldFriends, oldCreate, oldFindRequest, oldNotify
	})
	findUserByAccount = func(account string) (entity.User, bool, error) {
		return entity.User{ID: 2, Account: account}, true, nil
	}
	findUserByID = func(id uint64) (entity.User, bool, error) { return entity.User{ID: id}, true, nil }
	listActiveFriendships = func(uint64) ([]entity.Friendship, error) { return nil, nil }
	createRequest = func(request *entity.FriendRequest) (bool, error) {
		request.ID = 50
		request.Status = "accepted"
		return true, nil
	}
	findFriendRequestID = func(sender, recipient uint64) (uint64, bool, error) {
		if sender != 2 || recipient != 1 {
			t.Fatalf("reverse request lookup = %d -> %d", sender, recipient)
		}
		return 40, true, nil
	}
	type notification struct {
		user, id uint64
		status   string
	}
	var notifications []notification
	notifyRequest = func(_ string, user, id uint64, status string) error {
		notifications = append(notifications, notification{user, id, status})
		return nil
	}
	result, err := Create(1, "00100002", "hello", "secret")
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if result.Request.Status != "accepted" {
		t.Fatalf("request status = %q, want accepted", result.Request.Status)
	}
	if len(notifications) != 1 || notifications[0] != (notification{user: 2, id: 40, status: "accepted"}) {
		t.Fatalf("notifications = %#v", notifications)
	}
}

func TestListUsesBatchProfilesAndStableCursor(t *testing.T) {
	// 测试目标：验证列表查询使用一批 profile 加载、返回待处理计数，并生成稳定的下一页游标。
	// 构造方法：stub repository 返回一条 incoming 记录及 has_more=true，并记录 profile 查询次数。
	// 输入数据：用户 9 的 incoming 列表，limit=1，申请 ID=7 且 created_at 固定。
	// 预期行为：调用一次批量查询，响应包含双方资料、pending_count=3 和可解码到相同 ID/时间的游标。
	oldList, oldProfiles := listRequests, findUsersByIDs
	t.Cleanup(func() { listRequests, findUsersByIDs = oldList, oldProfiles })
	createdAt := time.Date(2026, 10, 5, 1, 2, 3, 0, time.UTC)
	listRequests = func(userID uint64, direction string, before *time.Time, beforeID uint64, limit int) ([]entity.FriendRequest, int64, bool, error) {
		if userID != 9 || direction != "incoming" || before != nil || beforeID != 0 || limit != 1 {
			t.Fatalf("list args = %d %s %v %d %d", userID, direction, before, beforeID, limit)
		}
		return []entity.FriendRequest{{ID: 7, SenderUserID: 2, RecipientUserID: 9, Status: "pending", CreatedAt: createdAt}}, 3, true, nil
	}
	profileCalls := 0
	findUsersByIDs = func(ids []uint64) ([]entity.User, error) {
		profileCalls++
		if len(ids) != 2 {
			t.Fatalf("profile IDs = %#v, want 2 IDs", ids)
		}
		return []entity.User{{ID: 2}, {ID: 9}}, nil
	}
	page, err := List(9, Incoming, "", 1)
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(page.Requests) != 1 || page.PendingCount != 3 || !page.HasMore || profileCalls != 1 {
		t.Fatalf("page = %#v, profile calls = %d", page, profileCalls)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(page.NextCursor)
	if err != nil {
		t.Fatalf("decode next cursor: %v", err)
	}
	var cursor requestCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		t.Fatalf("parse next cursor: %v", err)
	}
	if cursor.ID != 7 || !cursor.CreatedAt.Equal(createdAt) {
		t.Fatalf("cursor = %#v, want id 7 at %s", cursor, createdAt)
	}
}

func TestListRejectsMalformedCursorBeforeQuery(t *testing.T) {
	// 测试目标：验证格式错误的分页游标以客户端输入错误返回，不触发数据库访问。
	// 构造方法：替换列表 repository 为会失败的函数，再传入非法 base64 游标。
	// 输入数据：direction=outgoing、cursor=%%% 和默认页长。
	// 预期行为：返回 ErrInvalidRequest，repository 调用次数保持为零。
	oldList := listRequests
	t.Cleanup(func() { listRequests = oldList })
	calls := 0
	listRequests = func(uint64, string, *time.Time, uint64, int) ([]entity.FriendRequest, int64, bool, error) {
		calls++
		return nil, 0, false, nil
	}
	_, err := List(9, Outgoing, "%%%", 0)
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("List error = %v, want ErrInvalidRequest", err)
	}
	if calls != 0 {
		t.Fatalf("repository calls = %d, want 0", calls)
	}
}
