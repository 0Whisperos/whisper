package response

import (
	"testing"
	"time"
)

func TestFormatNullableProtocolTimeKeepsNil(t *testing.T) {
	// 测试目标：验证缺失撤回时间仍表示为nil，供JSON输出显式null。
	// 构造方法：直接以nil时间指针调用nullable格式化函数。
	// 输入数据：nil。
	// 预期行为：返回nil，不生成零值时间字符串。
	if formatted := FormatNullableProtocolTime(nil); formatted != nil {
		t.Fatalf("formatted=%v, want nil", formatted)
	}
}

func TestFormatNullableProtocolTimePreservesMicrosecondsAndOffset(t *testing.T) {
	// 测试目标：验证DATETIME(6)撤回时间的实际时刻和时区不因HTTP格式化改变。
	// 构造方法：构造带+08:00偏移和123456微秒的时间，格式化后按RFC3339Nano解析。
	// 输入数据：2026-10-23T10:11:12.123456+08:00。
	// 预期行为：输出完整微秒和偏移，解析后的时间与输入代表相同时刻。
	value := time.Date(2026, time.October, 23, 10, 11, 12, 123456000, time.FixedZone("CST", 8*60*60))
	formatted := FormatNullableProtocolTime(&value)
	if formatted == nil || *formatted != "2026-10-23T10:11:12.123456+08:00" {
		t.Fatalf("formatted=%v", formatted)
	}
	parsed, err := time.Parse(time.RFC3339Nano, *formatted)
	if err != nil || !parsed.Equal(value) {
		t.Fatalf("parsed=%v, error=%v, want %v", parsed, err, value)
	}
}

func TestFormatNullableProtocolTimeKeepsWholeSecondUTCInstant(t *testing.T) {
	// 测试目标：验证整秒UTC撤回时间保持可解析的RFC3339表示且不增加虚构小数。
	// 构造方法：构造没有小数秒的UTC时间并进行格式化和解析。
	// 输入数据：2026-10-23T02:11:12Z。
	// 预期行为：输出2026-10-23T02:11:12Z，解析后仍为同一整秒时刻。
	value := time.Date(2026, time.October, 23, 2, 11, 12, 0, time.UTC)
	formatted := FormatNullableProtocolTime(&value)
	if formatted == nil || *formatted != "2026-10-23T02:11:12Z" {
		t.Fatalf("formatted=%v", formatted)
	}
	parsed, err := time.Parse(time.RFC3339Nano, *formatted)
	if err != nil || !parsed.Equal(value) {
		t.Fatalf("parsed=%v, error=%v, want %v", parsed, err, value)
	}
}

func TestFormatProtocolTimeKeepsExistingSecondPrecision(t *testing.T) {
	// 测试目标：验证新增撤回时间精度要求不改变已有created_at等协议时间格式。
	// 构造方法：以带微秒和+08:00时区的时间调用原格式化函数。
	// 输入数据：2026-10-23T10:11:12.123456+08:00。
	// 预期行为：旧格式仍为2026-10-23T10:11:12+08:00。
	value := time.Date(2026, time.October, 23, 10, 11, 12, 123456000, time.FixedZone("CST", 8*60*60))
	if formatted := FormatProtocolTime(value); formatted != "2026-10-23T10:11:12+08:00" {
		t.Fatalf("formatted=%q", formatted)
	}
}
