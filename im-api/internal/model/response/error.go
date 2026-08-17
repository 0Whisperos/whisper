package response

type Error struct {
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
}
