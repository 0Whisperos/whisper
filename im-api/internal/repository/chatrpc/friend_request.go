package chatrpc

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	redisrepo "github.com/0Whisperos/whisper/im-server/internal/repository/redis"
)

const (
	friendRequestNotifyPath = "/internal/v1/friend-requests/notify"
	apiNodeID               = "im-api"
)

type FriendRequestNotification struct {
	TargetUserID uint64 `json:"target_user_id"`
	ConnectionID string `json:"connection_id"`
	RequestID    uint64 `json:"request_id"`
	Status       string `json:"status"`
}

var httpClient = &http.Client{Timeout: 3 * time.Second}

func NotifyFriendRequest(secret string, targetUserID, requestID uint64, status string) error {
	route, online, err := redisrepo.FindPresenceRoute(targetUserID)
	if err != nil || !online {
		return err
	}
	node, found, err := redisrepo.FindChatNode(route.NodeID)
	if err != nil || !found {
		return err
	}
	body, err := json.Marshal(FriendRequestNotification{TargetUserID: targetUserID, ConnectionID: route.ConnectionID, RequestID: requestID, Status: status})
	if err != nil {
		return fmt.Errorf("encode friend request notification: %w", err)
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	signature := sign(secret, apiNodeID, http.MethodPost, friendRequestNotifyPath, timestamp, body)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "http://"+node.RPCAddr+friendRequestNotifyPath, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build friend request notification: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Whisper-Node-Id", apiNodeID)
	req.Header.Set("X-Whisper-Timestamp", timestamp)
	req.Header.Set("X-Whisper-Signature", signature)
	response, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send friend request notification: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("friend request notification returned status %d", response.StatusCode)
	}
	return nil
}

// sign matches im-chat's length-prefixed HMAC-SHA256 canonical request format.
func sign(secret, nodeID, method, path, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	for _, field := range []string{nodeID, method, path, timestamp} {
		_ = binaryWriteLength(mac, uint64(len([]byte(field))))
		_, _ = mac.Write([]byte(field))
	}
	_ = binaryWriteLength(mac, uint64(len(body)))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

type byteWriter interface{ Write([]byte) (int, error) }

func binaryWriteLength(writer byteWriter, length uint64) error {
	return writeUint64(writer, length)
}
func writeUint64(writer byteWriter, value uint64) error {
	var raw [8]byte
	for i := 7; i >= 0; i-- {
		raw[i] = byte(value)
		value >>= 8
	}
	_, err := writer.Write(raw[:])
	return err
}
