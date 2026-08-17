package redis

import (
	"context"
	"errors"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
)

func TestChatNodeRepositorySelectReadyReturnsFirstReadyNodeByKey(t *testing.T) {
	// 测试目标：验证 chat node repository 只选择 ready 且有 public_ws_url 的节点，并按 key 字典序返回第一个。
	// 构造方法：在 miniredis 中写入多个 chat_nodes:* hash，其中包含非 ready、缺失 URL 和两个 ready 节点。
	// 输入数据：chat_nodes:002 和 chat_nodes:003 都 ready，002 的 key 字典序更小。
	// 预期行为：返回 ws://127.0.0.1:9002/ws。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewChatNodeRepository(client)
	server.HSet("chat_nodes:001", "state", "starting", "public_ws_url", "ws://127.0.0.1:9001/ws")
	server.HSet("chat_nodes:002", "state", "ready", "public_ws_url", "ws://127.0.0.1:9002/ws")
	server.HSet("chat_nodes:003", "state", "ready", "public_ws_url", "ws://127.0.0.1:9003/ws")
	server.HSet("chat_nodes:004", "state", "ready")

	wsURL, err := repository.SelectReady(context.Background())
	if err != nil {
		t.Fatalf("SelectReady returned an error: %v", err)
	}

	if wsURL != "ws://127.0.0.1:9002/ws" {
		t.Fatalf("wsURL = %q, want ws://127.0.0.1:9002/ws", wsURL)
	}
}

func TestChatNodeRepositorySelectReadyReturnsNoAvailableChatNode(t *testing.T) {
	// 测试目标：验证没有 ready chat node 时返回稳定 auth.ErrNoAvailableChatNode。
	// 构造方法：在 miniredis 中只写入 starting 节点和缺少 public_ws_url 的 ready 节点。
	// 输入数据：chat_nodes:001 state=starting，chat_nodes:002 state=ready 但无 public_ws_url。
	// 预期行为：错误可通过 errors.Is 判定为 ErrNoAvailableChatNode。
	server := newRedisServer(t)
	client := newTestClient(t, server)
	repository := NewChatNodeRepository(client)
	server.HSet("chat_nodes:001", "state", "starting", "public_ws_url", "ws://127.0.0.1:9001/ws")
	server.HSet("chat_nodes:002", "state", "ready")

	_, err := repository.SelectReady(context.Background())

	if !errors.Is(err, auth.ErrNoAvailableChatNode) {
		t.Fatalf("SelectReady error = %v, want ErrNoAvailableChatNode", err)
	}
}
