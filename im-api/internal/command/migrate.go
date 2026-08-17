package command

import (
	"github.com/0Whisperos/whisper/im-server/internal/app"
	"github.com/spf13/cobra"
)

func newMigrateCommand() *cobra.Command {
	var configPath string
	command := &cobra.Command{
		Use:   "migrate",
		Short: "Create or update database schema tables",
		Args:  cobra.NoArgs,
		RunE:  func(_ *cobra.Command, _ []string) error { return app.RunMigration(configPath) },
	}
	command.Flags().StringVar(
		&configPath,
		"config",
		"config.local.yaml",
		"path to the YAML configuration file",
	)
	return command
}
