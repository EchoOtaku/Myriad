//! 云端手记文档的状态机。没有 I/O。

/// 一篇云端手记文档。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteDocStatus {
    /// 只在管理端。不进公开列表 / SEO / sitemap。
    Draft,
    /// 到点才写成 `brew_items`。
    Scheduled,
    /// 已经有对应的公开文章。
    Published,
}

/// 定时发布不合法。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleError {
    /// 时间已经过了，应该直接发布，不要假装定时。
    AlreadyDue,
    /// 没给时间。
    MissingTime,
}

impl NoteDocStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Scheduled => "scheduled",
            Self::Published => "published",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "scheduled" => Some(Self::Scheduled),
            "published" => Some(Self::Published),
            _ => None,
        }
    }
}

/// 订一个未来时间。到点或更早都拒绝，调用方应改走发布。
pub fn schedule_at(now_ms: i64, scheduled_at_ms: Option<i64>) -> Result<i64, ScheduleError> {
    let at = scheduled_at_ms.ok_or(ScheduleError::MissingTime)?;
    if at <= now_ms {
        return Err(ScheduleError::AlreadyDue);
    }
    Ok(at)
}

/// 调度器：已到点的定时稿该落库。
pub fn is_due(status: NoteDocStatus, scheduled_at_ms: Option<i64>, now_ms: i64) -> bool {
    status == NoteDocStatus::Scheduled && scheduled_at_ms.is_some_and(|at| at <= now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_rejects_past_and_now() {
        assert_eq!(schedule_at(100, Some(100)), Err(ScheduleError::AlreadyDue));
        assert_eq!(schedule_at(100, Some(99)), Err(ScheduleError::AlreadyDue));
        assert_eq!(schedule_at(100, None), Err(ScheduleError::MissingTime));
        assert_eq!(schedule_at(100, Some(101)), Ok(101));
    }

    #[test]
    fn due_only_when_scheduled_and_time_up() {
        assert!(!is_due(NoteDocStatus::Draft, Some(1), 10));
        assert!(!is_due(NoteDocStatus::Published, Some(1), 10));
        assert!(!is_due(NoteDocStatus::Scheduled, Some(20), 10));
        assert!(is_due(NoteDocStatus::Scheduled, Some(10), 10));
        assert!(is_due(NoteDocStatus::Scheduled, Some(9), 10));
    }

    #[test]
    fn parse_round_trip() {
        for status in [
            NoteDocStatus::Draft,
            NoteDocStatus::Scheduled,
            NoteDocStatus::Published,
        ] {
            assert_eq!(NoteDocStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(NoteDocStatus::parse("other"), None);
    }
}
