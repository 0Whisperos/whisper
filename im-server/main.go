package main

import (
	"os"

	"github.com/0Whisperos/whisper/im-server/internal/cli"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
)

func main() {
	logging.Init()
	if err := cli.NewRootCommand().Execute(); err != nil {
		logging.Error("command failed", "error", err)
		os.Exit(1)
	}
}
