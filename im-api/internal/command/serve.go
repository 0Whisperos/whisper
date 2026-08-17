package command

import (
	"github.com/0Whisperos/whisper/im-server/internal/app"
	"github.com/spf13/cobra"
)

func NewServeCommand() *cobra.Command {
	var configPath string
	command := &cobra.Command{
		Use:   "serve",
		Short: "start the server",
		Args:  cobra.NoArgs,
		RunE:  func(_ *cobra.Command, _ []string) error { return app.RunServer(configPath) },
	}
	command.Flags().StringVar(
		&configPath,
		"config",
		"config.local.yaml",
		"path to the YAML configuration file",
	)
	return command
}
