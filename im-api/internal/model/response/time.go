package response

import "time"

func FormatProtocolTime(value time.Time) string {
	return value.Format("2006-01-02T15:04:05-07:00")
}

func formatProtocolTime(value time.Time) string { return FormatProtocolTime(value) }
