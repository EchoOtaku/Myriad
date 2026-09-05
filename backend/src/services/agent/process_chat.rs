// Chat-only Agent path. Strict Lite; no Planner, Recipe, or Pro.

use serde_json::{json, Value};

use super::agent_header::Agent;
use super::motion_overlay::{
    attach_motion_to_result, landing_motion, motion_context, publish_local_motion,
    spawn_motion_refinement, MotionPublication,
};
use super::response_agent;
use super::types::*;

impl Agent {
    pub(super) async fn process_chat(
        &self,
        request: UserRequest,
        mood_transition: Option<crate::services::agent::merope::MoodTransition>,
        round_motion_style: String,
    ) -> Result<AgentResponse, String> {
        let user_id = request.user_id;
        crate::services::agent::merope::note_chat_diary(&self.db, user_id, &request.raw_input)
            .await;
        let reply = match self.strict_lite_chat_response(&request).await {
            Ok(reply) => reply,
            Err(error) => {
                crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
                return Err(error);
            }
        };
        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
        let (reply, music) = publish_model_outfit_overlay(&self.db, &request, &reply, None).await;
        crate::services::agent::merope::spawn_chat_remember(
            user_id,
            request.raw_input.clone(),
            reply.clone(),
        );
        return attach_motion_to_result(
            Ok(AgentResponse {
                response_type: AgentResponseType::Answer,
                message: reply.clone(),
                data: Some(chat_reply_with_overlay(&request, &reply)),
                data_display: None,
                suggestions: vec![],
                task: None,
                confirmation: None,
                frontend_action: music.map(chat_music_frontend_action),
                performance: None,
            }),
            &request,
            mood_transition.clone(),
            &round_motion_style,
        )
        .await;
    }

    pub(super) async fn process_chat_with_progress(
        &self,
        request: UserRequest,
        progress_tx: tokio::sync::mpsc::Sender<AgentProgressEvent>,
        mood_transition: Option<crate::services::agent::merope::MoodTransition>,
        round_motion_style: String,
    ) -> Result<AgentResponse, String> {
        let user_id = request.user_id;

        // Refinements are scoped to this turn. Dropping the guards aborts any
        // Lite call that has outlived the meaning of its reaction.
        let mut motion_refinements = Vec::new();

        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 5,
                completed_steps: 0,
                total_steps: 1,
                message: response_agent::understanding_request(),
            })
            .await;

        // The reaction ships immediately. Short replies stay entirely on
        // the local path. Longer replies offer actual spoken text to Lite;
        // it refines delivery, not a reaction to input that is now over.
        let mut motion_preview_tx = None;
        if let Some(mood) = mood_transition.clone() {
            let reaction_context = motion_context(
                &request,
                user_id,
                crate::services::agent::merope::MotionPhase::Reaction,
                mood,
                round_motion_style.clone(),
                None,
                None,
            );
            publish_local_motion(&reaction_context, &progress_tx).await;
            // At most two updates: first stable sentence, then one bounded
            // long-reply refinement. Neither can be lost to a full slot.
            let (preview_tx, preview_rx) = tokio::sync::mpsc::channel(2);
            motion_preview_tx = Some(preview_tx);
            motion_refinements.push(spawn_motion_refinement(
                reaction_context,
                progress_tx.clone(),
                Some(preview_rx),
            ));
        }

        // Persistence still precedes chat context construction, but must
        // not stand in front of the character's immediate reaction.
        crate::services::agent::merope::note_chat_diary(&self.db, user_id, &request.raw_input)
            .await;

        let reply = match self
            .stream_strict_lite_chat_response(&request, &progress_tx, motion_preview_tx)
            .await
        {
            Ok(reply) => {
                publish_model_outfit_overlay(&self.db, &request, &reply, Some(&progress_tx))
                    .await
                    .0
            }
            Err(error) => {
                crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
                return Err(error);
            }
        };

        // A refinement that has not arrived by the end of generation is
        // stale. Never retain its sender beyond the run's terminal event.
        let mut delivery_publication = MotionPublication::None;
        for guard in motion_refinements.drain(..) {
            delivery_publication = delivery_publication.max(guard.stop().await);
        }
        // Do not overwrite a richer, already-visible baseline with the
        // generic landing floor (or replay its body beat).
        if let Some(mood) = mood_transition.clone() {
            let delivery_context = motion_context(
                &request,
                user_id,
                crate::services::agent::merope::MotionPhase::Delivery,
                mood,
                round_motion_style.clone(),
                Some(reply.clone()),
                None,
            );
            if let Some(performance) = landing_motion(&delivery_context, delivery_publication) {
                let _ = progress_tx
                    .send(AgentProgressEvent::PerformancePlan { performance })
                    .await;
            }
        }
        // Close the text stream only after the delivery beat is visible to
        // the client. This aligns it with TTS enqueue without delaying text.
        response_agent::finish_stream(&progress_tx).await;
        crate::services::agent::merope::spawn_chat_remember(
            user_id,
            request.raw_input.clone(),
            reply.clone(),
        );
        let performance = None;

        crate::services::agent::merope::mark_activity(&self.db, user_id, "idle").await;
        let _ = progress_tx
            .send(AgentProgressEvent::Progress {
                progress: 100,
                completed_steps: 1,
                total_steps: 1,
                message: response_agent::done_status(),
            })
            .await;

        return Ok(AgentResponse {
            response_type: AgentResponseType::Answer,
            message: reply.clone(),
            data: Some(chat_reply_with_overlay(&request, &reply)),
            data_display: None,
            suggestions: vec![],
            task: None,
            confirmation: None,
            frontend_action: None,
            performance,
        });
    }
}

fn chat_music_frontend_action(
    action: crate::services::agent::chat_music::ChatMusicAction,
) -> Value {
    json!({
        "type": "music_control",
        "action": action.as_str(),
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })
}

fn chat_reply_with_overlay(request: &UserRequest, reply: &str) -> Value {
    let mut data = crate::services::agent::chat_prompt::chat_reply_data(reply, &request.raw_input);
    let session_id = request
        .context
        .as_ref()
        .and_then(|context| context.session_id.as_deref())
        .unwrap_or("");
    if let Some(object) = data.as_object_mut() {
        object.insert(
            "outfitId".into(),
            match crate::services::agent::merope::overlay_outfit_id(request.user_id, session_id) {
                Some(id) => Value::String(id),
                None => Value::Null,
            },
        );
    }
    data
}

async fn publish_model_outfit_overlay(
    db: &sea_orm::DatabaseConnection,
    request: &UserRequest,
    reply: &str,
    progress_tx: Option<&tokio::sync::mpsc::Sender<AgentProgressEvent>>,
) -> (
    String,
    Option<crate::services::agent::chat_music::ChatMusicAction>,
) {
    let (spoken, directive, music) =
        crate::services::agent::chat_music::peel_chat_live_reply(reply);
    let Some(directive) =
        myriad_merope::wear_directive_after_reply(&request.raw_input, &spoken, directive)
    else {
        return (spoken, music);
    };
    let Some(session_id) = request
        .context
        .as_ref()
        .and_then(|context| context.session_id.as_deref())
    else {
        return (spoken, music);
    };
    let Some(outfit_id) = crate::services::agent::merope::apply_model_wear_directive(
        db,
        request.user_id,
        session_id,
        &directive,
    )
    .await
    else {
        return (spoken, music);
    };
    if let Some(progress_tx) = progress_tx {
        let _ = progress_tx
            .send(AgentProgressEvent::OutfitOverlay { outfit_id })
            .await;
    }
    (spoken, music)
}
