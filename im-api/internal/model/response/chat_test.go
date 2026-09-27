package response

import (
	"encoding/json"
	"testing"
)

func TestMessagePageEncodesConversationAndMemberCursors(t *testing.T) {
	// Test goal: verify the message page exposes the existing conversation and member cursors using the client protocol field names.
	// Construction: marshal a page with distinct last, current-member, and peer cursor values and no optional pagination cursors.
	// Input: last_seq=42, delivered_seq=40, read_seq=39, peer_delivered_seq=41, peer_read_seq=38.
	// Expected behavior: JSON contains all five named cursor fields with their values and keeps the empty message list as an array.
	page := MessagePage{
		Messages:         []Message{},
		LastSeq:          42,
		DeliveredSeq:     40,
		ReadSeq:          39,
		PeerDeliveredSeq: 41,
		PeerReadSeq:      38,
	}

	body, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("json.Marshal returned an error: %v", err)
	}
	want := `{"messages":[],"has_more":false,"last_seq":42,"delivered_seq":40,"read_seq":39,"peer_delivered_seq":41,"peer_read_seq":38}`
	if string(body) != want {
		t.Fatalf("JSON = %s, want %s", body, want)
	}
}
