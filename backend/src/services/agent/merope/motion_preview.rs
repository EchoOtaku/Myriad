//! A bounded preview of spoken output, used once to refine a long Chat reply.
//! No reasoning text, control markers, second transcript store, or model wait.

const MIN_PREVIEW_CHARS: usize = 96;
const MAX_PREVIEW_CHARS: usize = 600;

#[derive(Default)]
pub struct MotionPreview {
    text: String,
    chars: usize,
    sent: bool,
}

impl MotionPreview {
    pub fn push(&mut self, spoken: &str) -> Option<String> {
        if self.sent {
            return None;
        }
        for ch in spoken.chars().take(MAX_PREVIEW_CHARS - self.chars) {
            self.text.push(ch);
            self.chars += 1;
        }
        if self.chars < MIN_PREVIEW_CHARS {
            return None;
        }
        self.sent = true;
        Some(std::mem::take(&mut self.text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_replies_do_not_start_a_second_model() {
        let mut preview = MotionPreview::default();
        for text in ["你好", "，今天怎么样", "？"] {
            assert!(preview.push(text).is_none());
        }
    }

    #[test]
    fn long_replies_offer_one_bounded_actual_text_preview() {
        let mut preview = MotionPreview::default();
        assert!(preview.push(&"你".repeat(95)).is_none());
        assert_eq!(preview.push("好").unwrap().chars().count(), 96);
        assert!(preview.push(&"继续".repeat(10_000)).is_none());
        assert!(preview.text.is_empty());

        let mut preview = MotionPreview::default();
        assert_eq!(
            preview.push(&"字".repeat(10_000)).unwrap().chars().count(),
            600
        );
    }
}
