package friends

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/chatrpc"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
)

var (
	findUserByAccount     = mysql.FindUserByAccount
	findUserByID          = mysql.FindUserByID
	findUsersByIDs        = mysql.FindUsersByIDs
	listRequests          = mysql.ListFriendRequests
	createRequest         = mysql.CreateOrRefreshFriendRequest
	decideRequest         = mysql.DecideFriendRequest
	listActiveFriendships = mysql.ListActiveFriendships
	findFriendRequestID   = mysql.FindFriendRequestID
	notifyRequest         = chatrpc.NotifyFriendRequest
)

type Direction string

const (
	Incoming Direction = "incoming"
	Outgoing Direction = "outgoing"
)

type Request struct {
	Request   entity.FriendRequest
	Sender    entity.User
	Recipient entity.User
}

type Page struct {
	Requests     []Request
	PendingCount int64
	NextCursor   string
	HasMore      bool
}
type requestCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        uint64    `json:"id"`
}

const (
	DefaultRequestPageSize = 20
	MaxRequestPageSize     = 100
)

func SearchByAccount(account string) (entity.User, error) {
	if !validAccount(account) {
		return entity.User{}, ErrInvalidRequest
	}
	user, found, err := findUserByAccount(account)
	if err != nil {
		return entity.User{}, fmt.Errorf("search user by account: %w", err)
	}
	if !found {
		return entity.User{}, ErrUserNotFound
	}
	return user, nil
}

func Create(userID uint64, account, verification, rpcSecret string) (Request, error) {
	account = strings.TrimSpace(account)
	verification = strings.TrimSpace(verification)
	if !validAccount(account) || utf8.RuneCountInString(verification) > 200 {
		return Request{}, ErrInvalidRequest
	}
	recipient, found, err := findUserByAccount(account)
	if err != nil {
		return Request{}, fmt.Errorf("find friend request recipient: %w", err)
	}
	if !found {
		return Request{}, ErrUserNotFound
	}
	if recipient.ID == userID {
		return Request{}, ErrSelfRequest
	}
	friends, err := listActiveFriendships(userID)
	if err != nil {
		return Request{}, fmt.Errorf("check existing friendship: %w", err)
	}
	for _, friend := range friends {
		if friend.FriendUserID == recipient.ID {
			return Request{}, ErrAlreadyFriend
		}
	}
	sender, found, err := findUserByID(userID)
	if err != nil {
		return Request{}, fmt.Errorf("find friend request sender: %w", err)
	}
	if !found {
		return Request{}, ErrUserNotFound
	}
	row := entity.FriendRequest{SenderUserID: userID, RecipientUserID: recipient.ID, VerificationMessage: verification}
	autoAccepted, err := createRequest(&row)
	if err != nil {
		if errors.Is(err, mysql.ErrFriendshipAlreadyExists) {
			return Request{}, ErrAlreadyFriend
		}
		if errors.Is(err, mysql.ErrFriendRequestAlreadyPending) {
			return Request{}, ErrRequestPending
		}
		return Request{}, fmt.Errorf("create friend request: %w", err)
	}
	if autoAccepted {
		// The peer's request is now accepted as well; notify it so the peer refreshes both lists.
		if peer, ok, lookupErr := findFriendRequestID(row.RecipientUserID, row.SenderUserID); lookupErr == nil && ok {
			_ = notifyRequest(rpcSecret, row.RecipientUserID, peer, "accepted")
		}
		return Request{Request: row, Sender: sender, Recipient: recipient}, nil
	}
	_ = notifyRequest(rpcSecret, recipient.ID, row.ID, "pending")
	return Request{Request: row, Sender: sender, Recipient: recipient}, nil
}

func List(userID uint64, direction Direction, cursor string, limit int) (Page, error) {
	if direction != Incoming && direction != Outgoing {
		return Page{}, ErrInvalidDirection
	}
	if limit == 0 {
		limit = DefaultRequestPageSize
	}
	if limit < 1 || limit > MaxRequestPageSize {
		return Page{}, ErrInvalidRequest
	}
	var before *time.Time
	var beforeID uint64
	if cursor != "" {
		encoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return Page{}, ErrInvalidRequest
		}
		var parsed requestCursor
		if err := json.Unmarshal(encoded, &parsed); err != nil || parsed.ID == 0 || parsed.CreatedAt.IsZero() {
			return Page{}, ErrInvalidRequest
		}
		before, beforeID = &parsed.CreatedAt, parsed.ID
	}
	rows, pendingCount, hasMore, err := listRequests(userID, string(direction), before, beforeID, limit)
	if err != nil {
		return Page{}, fmt.Errorf("list friend requests: %w", err)
	}
	ids := make([]uint64, 0, len(rows)*2)
	for _, row := range rows {
		ids = append(ids, row.SenderUserID, row.RecipientUserID)
	}
	users, err := findUsersByIDs(ids)
	if err != nil {
		return Page{}, fmt.Errorf("load friend request profiles: %w", err)
	}
	byID := make(map[uint64]entity.User, len(users))
	for _, user := range users {
		byID[user.ID] = user
	}
	result := Page{Requests: make([]Request, 0, len(rows)), PendingCount: pendingCount, HasMore: hasMore}
	for _, row := range rows {
		sender, senderOK := byID[row.SenderUserID]
		recipient, recipientOK := byID[row.RecipientUserID]
		if !senderOK || !recipientOK {
			return Page{}, ErrUserNotFound
		}
		result.Requests = append(result.Requests, Request{Request: row, Sender: sender, Recipient: recipient})
	}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		encoded, err := json.Marshal(requestCursor{CreatedAt: last.CreatedAt, ID: last.ID})
		if err != nil {
			return Page{}, fmt.Errorf("encode friend request cursor: %w", err)
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return result, nil
}

func Decide(userID, requestID uint64, accept bool, rpcSecret string) (Request, error) {
	row, err := decideRequest(requestID, userID, accept)
	if err != nil {
		if errors.Is(err, mysql.ErrFriendRequestNotFound) {
			return Request{}, ErrRequestNotFound
		}
		if errors.Is(err, mysql.ErrFriendRequestNotPending) {
			return Request{}, ErrRequestNotPending
		}
		return Request{}, fmt.Errorf("decide friend request: %w", err)
	}
	if row.Status == "accepted" || row.Status == "rejected" {
		_ = notifyRequest(rpcSecret, row.SenderUserID, row.ID, row.Status)
	}
	sender, _, err := findUserByID(row.SenderUserID)
	if err != nil {
		return Request{}, fmt.Errorf("load friend request sender: %w", err)
	}
	recipient, _, err := findUserByID(row.RecipientUserID)
	if err != nil {
		return Request{}, fmt.Errorf("load friend request recipient: %w", err)
	}
	return Request{Request: row, Sender: sender, Recipient: recipient}, nil
}

func validAccount(account string) bool {
	if len(account) < 8 || len(account) > 12 {
		return false
	}
	for _, digit := range account {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}
