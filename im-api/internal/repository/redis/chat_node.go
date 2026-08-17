package redis

import (
	"context"
	"fmt"
	"sort"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	goredis "github.com/redis/go-redis/v9"
)

type ChatNodeRepository struct {
	client *goredis.Client
}

func NewChatNodeRepository(client *goredis.Client) *ChatNodeRepository {
	return &ChatNodeRepository{client: client}
}

func (repository *ChatNodeRepository) SelectReady(ctx context.Context) (string, error) {
	var cursor uint64
	var keys []string
	for {
		batch, nextCursor, err := repository.client.Scan(ctx, cursor, "chat_nodes:*", 100).Result()
		if err != nil {
			return "", fmt.Errorf("scan chat nodes: %w", err)
		}
		keys = append(keys, batch...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		values, err := repository.client.HGetAll(ctx, key).Result()
		if err != nil {
			return "", fmt.Errorf("read chat node %s: %w", key, err)
		}
		if values["state"] == "ready" && values["public_ws_url"] != "" {
			return values["public_ws_url"], nil
		}
	}
	return "", auth.ErrNoAvailableChatNode
}
