// Motion overlay for Agent turns: local floor, Lite refinement, attach to result.

use super::types::*;

fn request_rig_state(request: &UserRequest) -> Option<myriad_merope::RigStateSummary> {
    request
        .context
        .as_ref()
        .and_then(|context| context.rig_state.clone())
}

pub(super) async fn round_motion_style(
    request: &UserRequest,
    mood: Option<&crate::services::agent::merope::MoodTransition>,
) -> String {
    let Some(mood) = mood else {
        return request_rig_state(request)
            .map(|summary| summary.motion_style)
            .filter(|style| myriad_merope::RIG_STATE_MOTION_STYLES.contains(&style.as_str()))
            .unwrap_or_else(|| "even".to_string());
    };
    crate::services::agent::merope::resolve_round_motion_style(
        request_rig_state(request).as_ref(),
        mood.after.round() as i32,
        mood.arousal_after.round() as i32,
    )
    .await
}

pub(super) fn motion_context(
    request: &UserRequest,
    user_id: i32,
    phase: crate::services::agent::merope::MotionPhase,
    mood: crate::services::agent::merope::MoodTransition,
    motion_style: String,
    response_text: Option<String>,
    task_success: Option<bool>,
) -> crate::services::agent::merope::MotionContext {
    crate::services::agent::merope::MotionContext {
        user_id,
        phase,
        mood,
        activity: phase.activity().to_string(),
        user_text: request.raw_input.clone(),
        response_text,
        task_success,
        rig_state: request_rig_state(request),
        motion_style,
    }
}

pub(super) fn utterance_index_in_session(request: &UserRequest) -> u32 {
    request
        .context
        .as_ref()
        .and_then(|ctx| ctx.conversation_history.as_ref())
        .map(|history| {
            history
                .iter()
                .filter(|message| message.role == "user")
                .count()
                .saturating_sub(1) as u32
        })
        .unwrap_or(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub(super) enum MotionPublication {
    None,
    Local,
    Refined,
}

pub(super) struct MotionRefinementGuard {
    task: tokio::task::JoinHandle<()>,
    published: std::sync::Arc<std::sync::atomic::AtomicU8>,
}

impl MotionRefinementGuard {
    pub(super) async fn stop(mut self) -> MotionPublication {
        self.task.abort();
        // Abort is a request, not a completion barrier. A concurrent send can
        // still finish before cancellation is observed; inspect publication
        // only after the task has stopped, before choosing the landing floor.
        let _ = (&mut self.task).await;
        match self.published.load(std::sync::atomic::Ordering::Acquire) {
            0 => MotionPublication::None,
            1 => MotionPublication::Local,
            _ => MotionPublication::Refined,
        }
    }
}

impl Drop for MotionRefinementGuard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) async fn publish_local_motion(
    context: &crate::services::agent::merope::MotionContext,
    progress_tx: &tokio::sync::mpsc::Sender<AgentProgressEvent>,
) -> bool {
    if let Some(performance) = crate::services::agent::merope::local_directive(context) {
        return progress_tx
            .send(AgentProgressEvent::PerformancePlan { performance })
            .await
            .is_ok();
    }
    false
}

pub(super) fn landing_motion(
    context: &crate::services::agent::merope::MotionContext,
    publication: MotionPublication,
) -> Option<crate::services::agent::merope::PerformanceDirective> {
    if publication == MotionPublication::Refined {
        return None;
    }
    let mut performance = crate::services::agent::merope::local_directive(context)?;
    if publication == MotionPublication::Local {
        // The spoken preview already started the body beat. The full reply
        // may update the standing face, but must not restart that gesture.
        performance.plan.cues.clear();
    }
    Some(performance)
}

/** Refines a floor, optionally after a bounded preview of a longer reply. */
pub(super) fn spawn_motion_refinement(
    context: crate::services::agent::merope::MotionContext,
    progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    preview_rx: Option<
        tokio::sync::mpsc::Receiver<
            crate::services::agent::merope::motion_preview::MotionPreviewUpdate,
        >,
    >,
) -> MotionRefinementGuard {
    spawn_motion_refinement_with(
        context,
        progress_tx,
        preview_rx,
        crate::services::agent::merope::refine_motion,
    )
}

fn spawn_motion_refinement_with<F, Fut>(
    mut context: crate::services::agent::merope::MotionContext,
    progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
    mut preview_rx: Option<
        tokio::sync::mpsc::Receiver<
            crate::services::agent::merope::motion_preview::MotionPreviewUpdate,
        >,
    >,
    refine: F,
) -> MotionRefinementGuard
where
    F: FnOnce(crate::services::agent::merope::MotionContext) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Option<crate::services::agent::merope::PerformanceDirective>>
        + Send
        + 'static,
{
    let published = std::sync::Arc::new(std::sync::atomic::AtomicU8::new(
        MotionPublication::None as u8,
    ));
    let did_publish = published.clone();
    let task = tokio::spawn(async move {
        if let Some(preview_rx) = preview_rx.as_mut() {
            let preview = loop {
                let Some(update) = preview_rx.recv().await else {
                    return;
                };
                if let Some(spoken) = update.local {
                    context.phase = crate::services::agent::merope::MotionPhase::Delivery;
                    context.activity = context.phase.activity().to_string();
                    context.response_text = Some(spoken);
                    if publish_local_motion(&context, &progress_tx).await {
                        did_publish.store(
                            MotionPublication::Local as u8,
                            std::sync::atomic::Ordering::Release,
                        );
                    }
                    if progress_tx.is_closed() {
                        return;
                    }
                }
                if let Some(preview) = update.refinement {
                    break preview;
                }
            };
            // A provider may emit a whole answer in one delta. Give the caller
            // one short cancellation window before opening another request.
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            context.phase = crate::services::agent::merope::MotionPhase::Delivery;
            context.activity = context.phase.activity().to_string();
            context.response_text = Some(preview);
            if progress_tx.is_closed() {
                return;
            }
        }
        if let Some(performance) = refine(context).await {
            if progress_tx
                .send(AgentProgressEvent::PerformancePlan { performance })
                .await
                .is_ok()
            {
                did_publish.store(
                    MotionPublication::Refined as u8,
                    std::sync::atomic::Ordering::Release,
                );
            }
        }
    });
    MotionRefinementGuard { task, published }
}

pub(super) async fn attach_motion_to_result(
    result: Result<AgentResponse, String>,
    request: &UserRequest,
    mood: Option<crate::services::agent::merope::MoodTransition>,
    motion_style: &str,
) -> Result<AgentResponse, String> {
    let mut response = result?;
    let Some(mood) = mood else {
        return Ok(response);
    };
    let task_success = response.task.as_ref().and_then(|task| match task.status {
        TaskStatus::Completed => Some(true),
        TaskStatus::Failed | TaskStatus::Cancelled => Some(false),
        _ => None,
    });
    let phase = if task_success.is_some() {
        crate::services::agent::merope::MotionPhase::Outcome
    } else {
        crate::services::agent::merope::MotionPhase::Delivery
    };
    let context = motion_context(
        request,
        request.user_id,
        phase,
        mood,
        motion_style.to_string(),
        Some(response.message.clone()),
        task_success,
    );
    // The body carries the floor so a non-streaming client still gets acting;
    // awaiting Lite here used to put its whole timeout in front of the reply.
    response.performance = crate::services::agent::merope::local_directive(&context);
    Ok(response)
}

#[cfg(test)]
mod motion_refinement_tests {
    use super::*;
    use crate::services::agent::merope::motion_preview::MotionPreviewUpdate;
    use crate::services::agent::merope::{MoodTransition, MotionContext, MotionPhase};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    fn preview(text: &str) -> MotionPreviewUpdate {
        MotionPreviewUpdate {
            local: Some(text.into()),
            refinement: Some(text.into()),
        }
    }

    fn context() -> MotionContext {
        MotionContext {
            user_id: 1,
            phase: MotionPhase::Reaction,
            mood: MoodTransition {
                before: 70.0,
                after: 70.0,
                arousal_before: 48.0,
                arousal_after: 48.0,
                band_before: "calm".into(),
                band_after: "calm".into(),
                delta: 0.0,
                cause: "test".into(),
                revision: 1,
            },
            activity: "thinking".into(),
            user_text: "tell me about that".into(),
            response_text: None,
            task_success: None,
            rig_state: None,
            motion_style: "even".into(),
        }
    }

    #[tokio::test]
    async fn short_or_single_chunk_turn_never_starts_lite() {
        for emit_preview in [false, true] {
            let calls = Arc::new(AtomicUsize::new(0));
            let observed = calls.clone();
            let (tx, mut events) = tokio::sync::mpsc::channel(4);
            let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(1);
            let guard = spawn_motion_refinement_with(
                context(),
                tx,
                Some(preview_rx),
                move |_| async move {
                    observed.fetch_add(1, Ordering::Relaxed);
                    None
                },
            );
            if emit_preview {
                preview_tx
                    .send(preview("a whole buffered answer"))
                    .await
                    .unwrap();
            }
            tokio::task::yield_now().await;
            let publication = guard.stop().await;
            assert_ne!(publication, MotionPublication::Refined);
            assert_eq!(
                publication == MotionPublication::Local,
                events.recv().await.is_some()
            );
            assert!(events.recv().await.is_none());
            assert_eq!(calls.load(Ordering::Relaxed), 0);
        }
    }

    #[tokio::test]
    async fn long_reply_refines_delivery_using_spoken_context_and_marks_publication() {
        let (tx, mut events) = tokio::sync::mpsc::channel(4);
        let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(1);
        let guard =
            spawn_motion_refinement_with(context(), tx, Some(preview_rx), |context| async move {
                assert_eq!(context.phase, MotionPhase::Delivery);
                assert_eq!(context.activity, "talking");
                assert_eq!(
                    context.response_text.as_deref(),
                    Some("the actual spoken preview")
                );
                crate::services::agent::merope::local_directive(&context)
            });
        preview_tx
            .send(preview("the actual spoken preview"))
            .await
            .unwrap();
        // The deterministic delivery precedes its optional refinement.
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            assert!(matches!(event, AgentProgressEvent::PerformancePlan { .. }));
        }
        assert_eq!(guard.stop().await, MotionPublication::Refined);
    }

    #[tokio::test]
    async fn cancelled_refinement_cannot_publish_after_its_turn() {
        let (tx, mut events) = tokio::sync::mpsc::channel(4);
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let guard = spawn_motion_refinement_with(context(), tx, None, move |_| async move {
            signal.notify_one();
            std::future::pending().await
        });
        tokio::time::timeout(Duration::from_secs(1), entered.notified())
            .await
            .unwrap();
        assert_eq!(guard.stop().await, MotionPublication::None);
        assert!(tokio::time::timeout(Duration::from_secs(1), events.recv())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stopping_at_publication_boundary_reports_exactly_what_was_sent() {
        for _ in 0..128 {
            let (tx, mut events) = tokio::sync::mpsc::channel(1);
            let guard = spawn_motion_refinement_with(context(), tx, None, |context| async move {
                crate::services::agent::merope::local_directive(&context)
            });
            tokio::task::yield_now().await;
            let published = guard.stop().await;
            assert_eq!(
                published == MotionPublication::Refined,
                events.recv().await.is_some()
            );
            assert!(events.recv().await.is_none());
        }
    }

    #[tokio::test]
    async fn spoken_delivery_does_not_wait_for_a_stalled_director() {
        let (tx, mut events) = tokio::sync::mpsc::channel(4);
        let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(1);
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let guard =
            spawn_motion_refinement_with(context(), tx, Some(preview_rx), move |_| async move {
                signal.notify_one();
                std::future::pending().await
            });
        preview_tx
            .send(preview("the actual spoken preview"))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        let Some(AgentProgressEvent::PerformancePlan { performance }) = events.try_recv().ok()
        else {
            panic!("delivery must already be queued before the director starts");
        };
        assert_eq!(performance.phase, MotionPhase::Delivery);
        assert!(!performance.plan.cues.is_empty());
        assert_eq!(guard.stop().await, MotionPublication::Local);
        assert!(events.recv().await.is_none());
    }

    #[tokio::test]
    async fn backpressured_refinement_does_not_claim_publication() {
        // Local delivery fills the channel. Cancellation must not mistake the
        // director's blocked send for an already-visible refinement.
        let (tx, mut events) = tokio::sync::mpsc::channel(1);
        let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(1);
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let guard = spawn_motion_refinement_with(
            context(),
            tx,
            Some(preview_rx),
            move |context| async move {
                signal.notify_one();
                crate::services::agent::merope::local_directive(&context)
            },
        );
        preview_tx
            .send(preview("the actual spoken preview"))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        assert_eq!(guard.stop().await, MotionPublication::Local);
        assert!(events.recv().await.is_some());
        assert!(events.recv().await.is_none());
    }

    #[tokio::test]
    async fn disconnected_preview_does_not_start_a_director() {
        let (tx, events) = tokio::sync::mpsc::channel(1);
        let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(1);
        drop(events);
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let guard =
            spawn_motion_refinement_with(context(), tx, Some(preview_rx), move |_| async move {
                observed.fetch_add(1, Ordering::Relaxed);
                None
            });
        preview_tx
            .send(preview("the actual spoken preview"))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), preview_tx.closed())
            .await
            .unwrap();
        assert_eq!(guard.stop().await, MotionPublication::None);
        assert_eq!(calls.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn landing_updates_full_reply_baseline_without_replaying_or_overwriting_refinement() {
        let mut context = context();
        context.phase = MotionPhase::Delivery;
        context.response_text = Some("the full spoken reply".into());
        let initial = landing_motion(&context, MotionPublication::None).unwrap();
        assert!(!initial.plan.cues.is_empty());
        let landing = landing_motion(&context, MotionPublication::Local).unwrap();
        assert_eq!(landing.plan.baseline, initial.plan.baseline);
        assert!(landing.plan.cues.is_empty());
        assert!(landing_motion(&context, MotionPublication::Refined).is_none());
    }

    #[tokio::test]
    async fn first_sentence_plays_without_waiting_for_long_preview_or_director() {
        let (tx, mut events) = tokio::sync::mpsc::channel(2);
        let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(2);
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let guard =
            spawn_motion_refinement_with(context(), tx, Some(preview_rx), move |_| async move {
                observed.fetch_add(1, Ordering::Relaxed);
                None
            });
        preview_tx
            .send(MotionPreviewUpdate {
                local: Some("你好，很高兴见到你！".into()),
                refinement: None,
            })
            .await
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(event, AgentProgressEvent::PerformancePlan { .. }));
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        assert_eq!(guard.stop().await, MotionPublication::Local);
        assert!(events.recv().await.is_none());
    }
}
