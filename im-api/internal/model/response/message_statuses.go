package response

type MessageStatus struct {
	MessageID  string  `json:"message_id"`
	RecalledAt *string `json:"recalled_at"`
}

type MessageStatuses struct {
	Statuses []MessageStatus `json:"statuses"`
}
