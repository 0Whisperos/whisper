package cli

import (
	"github.com/0Whisperos/whisper/im-server/internal/seed"
	"github.com/spf13/cobra"
)

func newSeedCommand() *cobra.Command {
	var configPath string
	command := &cobra.Command{
		Use:   "seed",
		Short: "Create or verify the fixed seed account",
		Args:  cobra.NoArgs,
		RunE:  func(_ *cobra.Command, _ []string) error { return seed.Run(configPath) },
	}
	command.Flags().StringVar(
		&configPath,
		"config",
		"config.local.yaml",
		"path to the YAML configuration file",
	)
	return command
}
