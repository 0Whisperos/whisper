package redis

import "testing"

func TestSelectReadyChatNodeReturnsReadyNodePublicWebSocketURL(t *testing.T) {
	// Test goal: verify the repository selects a ready chat_nodes:* entry and returns its client URL.
	// Construction: start miniredis, write one complete ready node hash, then call SelectReadyChatNode.
	// Input data: chat_nodes:chat-001 with state=ready and public_ws_url=ws://127.0.0.1:9001/ws.
	// Expected behavior: found=true and PublicWSURL equals the Redis public_ws_url field.
	server := newRedisServer(t)
	setTestClient(t, server)
	server.HSet("chat_nodes:chat-001", "node_id", "chat-001")
	server.HSet("chat_nodes:chat-001", "public_ws_url", "ws://127.0.0.1:9001/ws")
	server.HSet("chat_nodes:chat-001", "rpc_addr", "127.0.0.1:9101")
	server.HSet("chat_nodes:chat-001", "state", "ready")
	server.HSet("chat_nodes:chat-001", "started_at", "2026-08-16T12:00:00+08:00")
	server.HSet("chat_nodes:chat-001", "last_heartbeat_at", "2026-08-16T12:00:10+08:00")

	node, found, err := SelectReadyChatNode()

	if err != nil {
		t.Fatalf("SelectReadyChatNode returned an error: %v", err)
	}
	if !found {
		t.Fatal("found = false, want true")
	}
	if node.PublicWSURL != "ws://127.0.0.1:9001/ws" {
		t.Fatalf("PublicWSURL = %q, want ws://127.0.0.1:9001/ws", node.PublicWSURL)
	}
}

func TestSelectReadyChatNodeIgnoresUnavailableAndIncompleteNodes(t *testing.T) {
	// Test goal: verify unavailable nodes and nodes without public_ws_url are not returned.
	// Construction: start miniredis, then write one draining node and one ready node without public_ws_url.
	// Input data: chat_nodes:chat-draining state=draining and chat_nodes:chat-missing-url state=ready.
	// Expected behavior: SelectReadyChatNode returns found=false and error=nil.
	server := newRedisServer(t)
	setTestClient(t, server)
	server.HSet("chat_nodes:chat-draining", "node_id", "chat-draining")
	server.HSet("chat_nodes:chat-draining", "public_ws_url", "ws://127.0.0.1:9002/ws")
	server.HSet("chat_nodes:chat-draining", "state", "draining")
	server.HSet("chat_nodes:chat-missing-url", "node_id", "chat-missing-url")
	server.HSet("chat_nodes:chat-missing-url", "state", "ready")

	_, found, err := SelectReadyChatNode()

	if err != nil {
		t.Fatalf("SelectReadyChatNode returned an error: %v", err)
	}
	if found {
		t.Fatal("found = true, want false")
	}
}

func TestSelectReadyChatNodeIgnoresKeysThatVanishBeforeHashRead(t *testing.T) {
	// Test goal: verify a key returned by scanning but missing by hash-read time is ignored.
	// Construction: start miniredis and call the package helper with a non-existent chat_nodes key.
	// Input data: key list containing chat_nodes:vanished, with no Redis hash stored for that key.
	// Expected behavior: selection returns found=false and error=nil.
	server := newRedisServer(t)
	setTestClient(t, server)

	_, found, err := selectReadyChatNodeFromKeys(t.Context(), []string{"chat_nodes:vanished"}, chooseFirstChatNode)

	if err != nil {
		t.Fatalf("selectReadyChatNodeFromKeys returned an error: %v", err)
	}
	if found {
		t.Fatal("found = true, want false")
	}
}

func TestSelectReadyChatNodeUsesChooserForMultipleReadyNodes(t *testing.T) {
	// Test goal: verify multiple ready nodes are passed to selection instead of always choosing the smallest node_id.
	// Construction: start miniredis, write chat-002 before chat-001, and inject a chooser returning the first eligible node.
	// Input data: both ready nodes include public_ws_url values, and the chooser returns index 0.
	// Expected behavior: chat-002 is returned even though node_id ordering would prefer chat-001.
	server := newRedisServer(t)
	setTestClient(t, server)
	server.HSet("chat_nodes:chat-002", "node_id", "chat-002")
	server.HSet("chat_nodes:chat-002", "public_ws_url", "ws://127.0.0.1:9002/ws")
	server.HSet("chat_nodes:chat-002", "state", "ready")
	server.HSet("chat_nodes:chat-001", "node_id", "chat-001")
	server.HSet("chat_nodes:chat-001", "public_ws_url", "ws://127.0.0.1:9001/ws")
	server.HSet("chat_nodes:chat-001", "state", "ready")

	node, found, err := selectReadyChatNodeFromKeys(t.Context(), []string{"chat_nodes:chat-002", "chat_nodes:chat-001"}, func(count int) (int, error) {
		if count != 2 {
			t.Fatalf("eligible node count = %d, want 2", count)
		}
		return 0, nil
	})

	if err != nil {
		t.Fatalf("selectReadyChatNodeFromKeys returned an error: %v", err)
	}
	if !found {
		t.Fatal("found = false, want true")
	}
	if node.NodeID != "chat-002" || node.PublicWSURL != "ws://127.0.0.1:9002/ws" {
		t.Fatalf("node = %#v, want chooser-selected chat-002", node)
	}
}

func chooseFirstChatNode(count int) (int, error) {
	return 0, nil
}
