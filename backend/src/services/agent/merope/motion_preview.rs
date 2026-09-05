//! Separate immediate spoken delivery from the optional long-reply director.
//! No reasoning text, control markers, second transcript store, or model wait.

const MIN_PREVIEW_CHARS: usize = 96;
const MAX_PREVIEW_CHARS: usize = 600;

#[derive(Default)]
pub struct MotionPreview {
    text: String,
    chars: usize,
    sent: bool,
    local_sent: bool,
}

#[derive(Default)]
pub struct MotionPreviewUpdate {
    pub local: Option<String>,
    pub refinement: Option<String>,
}

impl MotionPreview {
    pub fn push(&mut self, spoken: &str) -> Option<MotionPreviewUpdate> {
        if self.sent {
            return None;
        }
        let mut update = MotionPreviewUpdate::default();
        for ch in spoken.chars().take(MAX_PREVIEW_CHARS - self.chars) {
            if self.text.is_empty() && ch.is_whitespace() {
                continue;
            }
            self.text.push(ch);
            self.chars += 1;
            // Strong sentence boundaries are safe even across token splits.
            // A Latin full stop waits for following whitespace (not decimals
            // or URLs). This is a bounded acting preview, not a second speech
            // transcript or a per-sentence model request.
            let boundary = matches!(ch, '。' | '！' | '？' | '!' | '?' | '\n')
                || (ch.is_whitespace() && self.text.trim_end().ends_with('.'));
            if !self.local_sent && self.chars >= 3 && (boundary || self.chars >= MIN_PREVIEW_CHARS)
            {
                self.local_sent = true;
                update.local = Some(self.text.trim().to_string());
            }
        }
        if self.chars >= MIN_PREVIEW_CHARS {
            self.sent = true;
            update.refinement = Some(std::mem::take(&mut self.text));
        }
        (update.local.is_some() || update.refinement.is_some()).then_some(update)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_replies_do_not_start_a_second_model() {
        let mut preview = MotionPreview::default();
        for text in ["你好", "，今天怎么样", "？"] {
            if let Some(update) = preview.push(text) {
                assert_eq!(update.local.as_deref(), Some("你好，今天怎么样？"));
                assert!(update.refinement.is_none());
            }
        }
    }

    #[test]
    fn long_replies_offer_one_bounded_actual_text_preview() {
        let mut preview = MotionPreview::default();
        assert!(preview.push(&"你".repeat(95)).is_none());
        let update = preview.push("好").unwrap();
        assert_eq!(update.local.unwrap().chars().count(), 96);
        assert_eq!(update.refinement.unwrap().chars().count(), 96);
        assert!(preview.push(&"继续".repeat(10_000)).is_none());
        assert!(preview.text.is_empty());

        let mut preview = MotionPreview::default();
        assert_eq!(
            preview
                .push(&"字".repeat(10_000))
                .unwrap()
                .refinement
                .unwrap()
                .chars()
                .count(),
            600
        );
    }

    #[test]
    fn first_stable_sentence_is_immediate_and_only_long_replies_refine() {
        for sentence in [
            "你好！",
            "今日は楽しいね！",
            "你好，今天真开心！",
            "That sounds lovely!",
            "A complete sentence. ",
        ] {
            let mut preview = MotionPreview::default();
            let mut local = Vec::new();
            for ch in sentence.chars() {
                if let Some(update) = preview.push(&ch.to_string()) {
                    local.extend(update.local);
                    assert!(update.refinement.is_none());
                }
            }
            assert_eq!(local, vec![sentence.trim().to_string()]);
            let update = preview.push(&"后续".repeat(100)).unwrap();
            assert!(update.local.is_none());
            assert!(update.refinement.is_some());
            assert!(preview.push("再说一点。").is_none());
        }
    }

    #[test]
    fn buffered_answer_keeps_first_sentence_for_local_and_context_for_refinement() {
        let mut preview = MotionPreview::default();
        let update = preview
            .push(&format!("你好，很高兴见到你！{}", "后续内容".repeat(100)))
            .unwrap();
        assert_eq!(update.local.as_deref(), Some("你好，很高兴见到你！"));
        assert!(update.refinement.unwrap().contains("后续内容"));
    }

    #[test]
    fn whitespace_and_decimal_fragments_do_not_trigger_an_empty_or_partial_sentence() {
        let mut preview = MotionPreview::default();
        assert!(preview.push(&" \n".repeat(1000)).is_none());
        assert!(preview.push("The value is 3.").is_none());
        assert!(preview
            .push("14 and the URL is https://example.com")
            .is_none());
        let update = preview.push(" so it works!").unwrap();
        assert!(update.local.unwrap().ends_with("so it works!"));
        assert!(update.refinement.is_none());
    }
}
