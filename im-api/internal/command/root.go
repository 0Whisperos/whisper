package command

import (
	"github.com/spf13/cobra"
)

func NewRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:          "im-server",
		Short:        "Whisper IM server management CLI",
		SilenceUsage: true,
	}
	root.AddCommand(newMigrateCommand())
	root.AddCommand(newSeedCommand())
	root.AddCommand(NewServeCommand())
	return root
}
