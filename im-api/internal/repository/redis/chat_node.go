package redis

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"

	"github.com/0Whisperos/whisper/im-server/internal/global"
)

const (
	chatNodeKeyPattern = "chat_nodes:*"
	chatNodeReadyState = "ready"
)

type ChatNode struct {
	NodeID          string
	PublicWSURL     string
	RPCAddr         string
	State           string
	StartedAt       string
	LastHeartbeatAt string
}

func SelectReadyChatNode() (ChatNode, bool, error) {
	if global.RedisClient == nil {
		return ChatNode{}, false, ErrNotInitialized
	}

	ctx := context.Background()
	iterator := global.RedisClient.Scan(ctx, 0, chatNodeKeyPattern, 0).Iterator()
	keys := make([]string, 0)
	for iterator.Next(ctx) {
		keys = append(keys, iterator.Val())
	}
	if err := iterator.Err(); err != nil {
		return ChatNode{}, false, fmt.Errorf("scan chat nodes: %w", err)
	}
	return selectReadyChatNodeFromKeys(ctx, keys, randomChatNodeIndex)
}

func selectReadyChatNodeFromKeys(ctx context.Context, keys []string, chooseIndex func(int) (int, error)) (ChatNode, bool, error) {
	nodes := make([]ChatNode, 0)
	for _, key := range keys {
		values, err := global.RedisClient.HGetAll(ctx, key).Result()
		if err != nil {
			return ChatNode{}, false, fmt.Errorf("read chat node: %w", err)
		}
		if len(values) == 0 {
			continue
		}
		node := ChatNode{
			NodeID:          values["node_id"],
			PublicWSURL:     values["public_ws_url"],
			RPCAddr:         values["rpc_addr"],
			State:           values["state"],
			StartedAt:       values["started_at"],
			LastHeartbeatAt: values["last_heartbeat_at"],
		}
		if node.State == chatNodeReadyState && node.PublicWSURL != "" {
			nodes = append(nodes, node)
		}
	}
	if len(nodes) == 0 {
		return ChatNode{}, false, nil
	}
	index, err := chooseIndex(len(nodes))
	if err != nil {
		return ChatNode{}, false, err
	}
	if index < 0 || index >= len(nodes) {
		return ChatNode{}, false, fmt.Errorf("choose chat node: index %d out of range for %d nodes", index, len(nodes))
	}
	return nodes[index], true, nil
}

func randomChatNodeIndex(count int) (int, error) {
	if count <= 0 {
		return 0, fmt.Errorf("choose chat node: node count must be positive")
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(count)))
	if err != nil {
		return 0, fmt.Errorf("choose chat node: %w", err)
	}
	return int(value.Int64()), nil
}
