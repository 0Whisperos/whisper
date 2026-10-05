package chatrpc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"testing"
)

func TestSignMatchesChatNodeCanonicalRequest(t *testing.T) {
	// 测试目标：验证内部 RPC 签名遵守 im-chat 的长度前缀 HMAC-SHA256 协议。
	// 构造方法：用独立标准库步骤按字段顺序编码 node_id、method、path、timestamp 和 body。
	// 输入数据：im-api、POST、通知路径、固定时间戳及 UTF-8 JSON body。
	// 预期行为：Go 客户端签名与独立 canonical 计算出的 64 位小写十六进制签名完全一致。
	secret, nodeID, method, path, timestamp := "rpc-secret", "im-api", "POST", friendRequestNotifyPath, "1791158400"
	body := []byte(`{"target_user_id":8,"connection_id":"c-1","request_id":42,"status":"pending"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	fields := [][]byte{[]byte(nodeID), []byte(method), []byte(path), []byte(timestamp), body}
	for _, field := range fields {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(field)))
		_, _ = mac.Write(length[:])
		_, _ = mac.Write(field)
	}
	want := hex.EncodeToString(mac.Sum(nil))
	if got := sign(secret, nodeID, method, path, timestamp, body); got != want {
		t.Fatalf("signature = %s, want %s", got, want)
	}
}
