use time::{OffsetDateTime, PrimitiveDateTime, UtcOffset};

/// The fixed storage offset used for im-chat DATETIME values.
const STORAGE_OFFSET: UtcOffset = match UtcOffset::from_hms(8, 0, 0) {
    Ok(offset) => offset,
    Err(_) => unreachable!(),
};

pub(crate) fn to_database_datetime(value: OffsetDateTime) -> PrimitiveDateTime {
    let local = to_storage_offset(value);
    PrimitiveDateTime::new(local.date(), local.time())
}

pub(crate) fn to_storage_offset(value: OffsetDateTime) -> OffsetDateTime {
    value.to_offset(STORAGE_OFFSET)
}

pub(crate) fn from_database_datetime(value: PrimitiveDateTime) -> OffsetDateTime {
    value.assume_offset(STORAGE_OFFSET)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn converts_utc_instant_to_shanghai_database_wall_time() {
        // 测试目标：验证 UTC 瞬间写入 DATETIME 时转换为 Asia/Shanghai 墙上时间。
        // 构造方法：使用固定 UTC 输入调用数据库时间转换 helper。
        // 输入数据：2026-09-20 01:58:00 UTC。
        // 预期行为：数据库值为 2026-09-20 09:58:00，不携带时区。
        let stored = to_database_datetime(datetime!(2026-09-20 01:58:00 UTC));

        assert_eq!(stored, datetime!(2026-09-20 09:58:00));
    }

    #[test]
    fn round_trips_database_wall_time_with_shanghai_offset() {
        // 测试目标：验证数据库 DATETIME 读回后恢复为正确的 Asia/Shanghai 时刻。
        // 构造方法：先将 UTC 瞬间转换为数据库值，再按存储偏移恢复。
        // 输入数据：2026-09-19 23:30:00 UTC，转换后跨到次日。
        // 预期行为：恢复结果仍表示同一瞬间，并带有 +08:00 偏移。
        let original = datetime!(2026-09-19 23:30:00 UTC);
        let restored = from_database_datetime(to_database_datetime(original));

        assert_eq!(restored, original);
        assert_eq!(restored.offset(), STORAGE_OFFSET);
        assert_eq!(restored.to_string(), "2026-09-20 7:30:00.0 +08:00:00");
    }
}
