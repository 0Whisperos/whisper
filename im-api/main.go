package main

import (
	"os"

	"github.com/0Whisperos/whisper/im-server/internal/command"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
)

func main() {
	logging.Init()
	if err := command.NewRootCommand().Execute(); err != nil {
		logging.Error("command failed", "error", err)
		os.Exit(1)
	}
}
