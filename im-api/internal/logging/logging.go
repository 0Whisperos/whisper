package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"runtime"
	"time"
)

var logger *slog.Logger

func init() {
	initLogger(os.Stderr)
}

func Init() {
	initLogger(os.Stderr)
	slog.SetDefault(logger)
}

func Debug(message string, arguments ...any) {
	write(slog.LevelDebug, message, arguments...)
}

func Info(message string, arguments ...any) {
	write(slog.LevelInfo, message, arguments...)
}

func Warn(message string, arguments ...any) {
	write(slog.LevelWarn, message, arguments...)
}

func Error(message string, arguments ...any) {
	write(slog.LevelError, message, arguments...)
}

func initLogger(writer io.Writer) {
	logger = slog.New(slog.NewTextHandler(writer, &slog.HandlerOptions{AddSource: true}))
}

func write(level slog.Level, message string, arguments ...any) {
	context := context.Background()
	if !logger.Enabled(context, level) {
		return
	}

	var programCounters [1]uintptr
	if callers := runtime.Callers(3, programCounters[:]); callers == 0 {
		logger.Log(context, level, message, arguments...)
		return
	}

	record := slog.NewRecord(time.Now(), level, message, programCounters[0])
	record.Add(arguments...)
	_ = logger.Handler().Handle(context, record)
}
