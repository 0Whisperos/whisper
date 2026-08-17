package handler

import (
	"errors"
	"net/http"

	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/model/response"
	"github.com/gin-gonic/gin"
)

type errorMapping struct {
	Err        error
	StatusCode int
	ErrorCode  string
	Message    string
}

func writeError(context *gin.Context, err error, mappings ...errorMapping) bool {
	if err == nil {
		return false
	}
	for _, mapping := range mappings {
		if errors.Is(err, mapping.Err) {
			context.JSON(mapping.StatusCode, response.Error{
				ErrorCode: mapping.ErrorCode,
				Message:   mapping.Message,
			})
			return true
		}
	}
	logging.Error("request failed", "error", err)
	context.JSON(http.StatusInternalServerError, response.Error{
		ErrorCode: "internal_error",
		Message:   "internal error",
	})
	return true
}
