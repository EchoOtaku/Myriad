use super::*;
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde_json::json;
use test_support::{Fixture, png};

#[tokio::test]
async fn postgres_writer_fencing_and_delete_retry() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let payload = validate_bytes(&png(), "image/png", 1024 * 1024).unwrap();
    let token = Uuid::new_v4();
    let ctx = MediaContext::site(MediaActor::admin(1).unwrap(), MediaSource::Upload);
    let row = assets::insert_staging(
        &f.db,
        &ctx,
        &payload,
        "test.png",
        None,
        MediaExposure::Private,
        token,
        600,
    )
    .await
    .unwrap();
    let key = row.storage_key.unwrap();
    f.service.store().stage_bytes(token, &png()).await.unwrap();
    f.db.execute_unprepared(&format!(
        "UPDATE media_assets SET write_lease_until = NOW() - interval '1 second' WHERE id = {}",
        row.id
    ))
    .await
    .unwrap();
    assert_eq!(
        f.service
            .renew_write_lease(&f.db, row.id, token)
            .await
            .unwrap_err(),
        MediaError::NotReady
    );
    f.service.recover_expired(&f.db, 16).await.unwrap();
    assert_eq!(
        f.service
            .commit_staged(&f.db, row.id, token, &key, &content_path(row.id))
            .await
            .unwrap_err(),
        MediaError::NotReady
    );
    assert!(
        f.service
            .store()
            .final_checksum(&key)
            .await
            .unwrap()
            .is_none()
    );
    let image = f.image().await;
    // Simulate process death after marking deleting, before unlink.
    f.db.execute_unprepared(&format!(
        "UPDATE media_assets SET state = 'deleting' WHERE id = {}",
        image.id
    ))
    .await
    .unwrap();
    maintenance::retry_deletions(&f.service, &f.db, 16)
        .await
        .unwrap();
    assert_eq!(
        assets::find_by_id(&f.db, image.id)
            .await
            .unwrap()
            .unwrap()
            .state
            .as_deref(),
        Some("deleted")
    );
    assert!(
        f.service
            .store()
            .final_checksum(&storage_key(image.public_id, "png").unwrap())
            .await
            .unwrap()
            .is_none()
    );
    f.close().await;
}

#[tokio::test]
async fn postgres_result_references_and_mailbox_rollback_together() {
    use crate::services::ai_task_registry::*;
    let Some(f) = Fixture::new().await else {
        return;
    };
    let image = f.image().await;
    let task = PersistedAiTask {
        runtime_id: "test".into(),
        subject_id: 1,
        owner_id: 1,
        tapp_id: "test".into(),
        idempotency_key: None,
        request_hash: [0; 32],
        retain_until: chrono::Utc::now().timestamp() + 900,
        snapshot: AiTaskSnapshot {
            task_id: "test-result".into(),
            status: AiTaskStatus::Completed,
            operation: myriad_tapp_contract::manifest::TappAiOperation::Image,
            delivery: AiTaskDelivery::Result,
            created_at: "now".into(),
            updated_at: "now".into(),
            result: Some(json!({"url": image.content_path})),
            error: None,
            usage: serde_json::from_value(json!({
                "calls": {"limit": 10, "used": 0, "remaining": 10, "resetsAt": "x"},
                "tokens": {"limit": 10, "used": 0, "remaining": 10, "resetsAt": "x"},
                "cooldown": {"requiredSeconds": 0, "remainingSeconds": 0},
                "restricted": false, "unlimited": false, "role": "user"
            }))
            .unwrap(),
        },
    };
    f.db.execute_unprepared("CREATE FUNCTION fail_media_ref() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected media ref failure'; END $$; CREATE TRIGGER fail_media_ref BEFORE INSERT ON media_references FOR EACH ROW EXECUTE FUNCTION fail_media_ref()").await.unwrap();
    assert!(
        crate::services::ai_task_runtime::persist_terminal_task(&f.db, &task)
            .await
            .is_err()
    );
    let counts = f.db.query_one_raw(Statement::from_string(DatabaseBackend::Postgres,
        "SELECT (SELECT COUNT(*) FROM tapp_runtime_registry)::bigint AS tasks, (SELECT COUNT(*) FROM tapp_runtime_mailbox)::bigint AS messages")).await.unwrap().unwrap();
    assert_eq!(counts.try_get::<i64>("", "tasks").unwrap(), 0);
    assert_eq!(counts.try_get::<i64>("", "messages").unwrap(), 0);
    f.db.execute_unprepared("DROP TRIGGER fail_media_ref ON media_references")
        .await
        .unwrap();
    crate::services::ai_task_runtime::persist_terminal_task(&f.db, &task)
        .await
        .unwrap();
    assert_eq!(
        f.service.delete(&f.db, image.id).await.unwrap_err(),
        MediaError::InUse
    );
    f.close().await;
}

#[tokio::test]
async fn postgres_html_publish_and_stickers_protect_assets() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let image = f.image().await;
    let txn = f.db.begin().await.unwrap();
    let (_, body) = publish_cited_media(
        &txn,
        &[],
        None,
        &format!("<img src='{}'>", image.content_path),
    )
    .await
    .unwrap();
    assert!(body.contains("/media/assets/"));
    bind_note_published(&txn, 71, None, &body, &[])
        .await
        .unwrap();
    let layout = json!({"standard": [], "free": [{"type": "sticker", "config": {"imageUrl": image.content_path}}]});
    let rewritten = bind_and_publish_dashboard_layout(&txn, &layout.to_string(), &[])
        .await
        .unwrap();
    assert!(rewritten.contains("/media/assets/"));
    txn.commit().await.unwrap();
    assert_eq!(
        f.service.delete(&f.db, image.id).await.unwrap_err(),
        MediaError::InUse
    );
    assert_eq!(
        f.service.unpublish(&f.db, image.id).await.unwrap_err(),
        MediaError::PublicInUse
    );
    f.close().await;
}

#[tokio::test]
async fn postgres_upgrade_resumes_over_1000_and_preserves_cached_citations() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let legacy_root = f.service.store().root().join("legacy");
    let paths = LegacyPaths {
        federation_root: legacy_root.join("federation"),
        cache_images: legacy_root.join("cache"),
    };
    let hash = "a".repeat(64);
    let url = format!("/api/phantasi/image-cache/aa/{hash}.png");
    let source = paths.cache_images.join("aa").join(format!("{hash}.png"));
    tokio::fs::create_dir_all(source.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(&source, png()).await.unwrap();
    f.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "INSERT INTO phantasi_note_docs(user_id, title, content_md) SELECT 1, 'old note', $1 FROM generate_series(1,1001)",
        [format!("<img src='{url}'>").into()])).await.unwrap();
    let first = upgrade::advance(&f.db, f.service.store(), &paths, &[], false)
        .await
        .unwrap();
    assert!(!first.complete);
    let mut progress = upgrade::advance(&f.db, f.service.store(), &paths, &[], false)
        .await
        .unwrap();
    assert!(progress.error.is_none(), "{:?}", progress.error);
    assert_eq!(upgrade::status(&f.db).await.unwrap().after, progress.after);
    let migrated_id = resolve_asset_id(&f.db, &url).await.unwrap().unwrap();
    assert!(
        !assets::find_by_id(&f.db, migrated_id)
            .await
            .unwrap()
            .unwrap()
            .references_complete
    );
    // Recreate the store handle as after a process restart; progress is only in DB.
    let resumed_store = MediaStore::new(f.service.store().root().to_path_buf());
    for _ in 0..80 {
        if progress.complete {
            break;
        }
        progress = upgrade::advance(&f.db, &resumed_store, &paths, &[], false)
            .await
            .unwrap();
        assert!(
            progress.error.is_none(),
            "phase {} cursor {}: {:?}",
            progress.phase,
            progress.after,
            progress.error
        );
    }
    assert!(progress.complete);
    assert_eq!(active_count(&f.db, migrated_id).await.unwrap(), 1001);
    assert!(
        assets::find_by_id(&f.db, migrated_id)
            .await
            .unwrap()
            .unwrap()
            .references_complete
    );
    let count_before = progress.scanned;
    assert_eq!(
        upgrade::advance(&f.db, &resumed_store, &paths, &[], false)
            .await
            .unwrap()
            .scanned,
        count_before
    );
    // Removing the cache volume must not remove historical media bytes.
    tokio::fs::remove_dir_all(&paths.cache_images)
        .await
        .unwrap();
    let row = assets::find_by_id(&f.db, migrated_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tokio::fs::read(resumed_store.final_path(&row.storage_key.unwrap()).unwrap())
            .await
            .unwrap(),
        png()
    );
    assert_eq!(
        f.service.delete(&f.db, migrated_id).await.unwrap_err(),
        MediaError::InUse
    );
    f.close().await;
}

#[tokio::test]
async fn postgres_upgrade_failure_keeps_cursor_and_retries() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let paths = LegacyPaths {
        federation_root: f.service.store().root().join("legacy"),
        cache_images: f.service.store().root().join("cache"),
    };
    f.db.execute_unprepared("INSERT INTO media_assets(kind,url,mime,name,size) VALUES ('upload','/media/federation/1/missing.png','image/png','missing.png',0)").await.unwrap();
    let mut failed = upgrade::advance(&f.db, f.service.store(), &paths, &[], false)
        .await
        .unwrap();
    for _ in 0..20 {
        if failed.error.is_some() {
            break;
        }
        failed = upgrade::advance(&f.db, f.service.store(), &paths, &[], false)
            .await
            .unwrap();
    }
    assert_eq!(failed.error.as_deref(), Some("MEDIA_MISSING"));
    assert_eq!(failed.after, "");
    assert!(!failed.complete);
    tokio::fs::create_dir_all(paths.federation_root.join("1"))
        .await
        .unwrap();
    tokio::fs::write(paths.federation_root.join("1/missing.png"), png())
        .await
        .unwrap();
    let retried = upgrade::advance(&f.db, f.service.store(), &paths, &[], false)
        .await
        .unwrap();
    assert!(retried.error.is_none());
    assert_eq!(retried.phase, 1);
    f.close().await;
}

#[tokio::test]
async fn postgres_persona_url_rewrite_preserves_generation_and_public_avatar() {
    use crate::services::agent::merope;
    let Some(f) = Fixture::new().await else {
        return;
    };
    let portrait = f.image().await;
    let avatar = f.image().await;
    f.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "INSERT INTO agent_persona(id,name,personality,portrait_asset_id,avatar_asset_id,avatar_generation,updated_at) VALUES ('site','Test','Test',$1,$2,'{\"fingerprint\":\"keep\"}',NOW())",
        [portrait.content_path.clone().into(), avatar.content_path.clone().into()])).await.unwrap();
    let txn = f.db.begin().await.unwrap();
    let portrait_url = publish_local_url(&txn, &portrait.content_path, &[])
        .await
        .unwrap();
    let avatar_url = publish_local_url(&txn, &avatar.content_path, &[])
        .await
        .unwrap();
    let persona = merope::get_persona_on(&txn).await.unwrap().unwrap();
    let saved = merope::rewrite_persona_media_urls(
        &txn,
        persona,
        Some(portrait_url),
        Some(avatar_url.clone()),
    )
    .await
    .unwrap();
    bind_persona(
        &txn,
        saved.portrait_asset_id.as_deref(),
        saved.avatar_asset_id.as_deref(),
        saved.visual_profile.as_ref(),
        &[],
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();
    assert_eq!(saved.avatar_asset_id.as_deref(), Some(avatar_url.as_str()));
    assert_eq!(
        saved.avatar_generation,
        Some(json!({"fingerprint": "keep"}))
    );
    assert_eq!(
        f.service.delete(&f.db, avatar.id).await.unwrap_err(),
        MediaError::InUse
    );
    assert!(matches!(
        resolve_public_asset(
            &f.db,
            f.service.store(),
            avatar.public_id,
            avatar_url.rsplit('/').next().unwrap()
        )
        .await
        .unwrap(),
        ServeOutcome::File(_)
    ));
    f.close().await;
}

#[tokio::test]
async fn postgres_channel_reference_failure_never_admits_run() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let user_id = 910071;
    f.db.execute_unprepared("INSERT INTO users(id,username,is_admin,auth_provider) VALUES (910071,'media-channel-test',TRUE,'local')").await.unwrap();
    let image = f.image().await;
    f.db.execute_unprepared("CREATE FUNCTION reject_channel_media() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected media ref failure'; END $$; CREATE TRIGGER reject_channel_media BEFORE INSERT ON media_references FOR EACH ROW EXECUTE FUNCTION reject_channel_media()").await.unwrap();
    let claims = crate::middleware::auth::Claims {
        sub: user_id.to_string(),
        username: "media-channel-test".into(),
        is_admin: true,
        is_owner: false,
        exp: chrono::Utc::now().timestamp() + 60,
        iat: chrono::Utc::now().timestamp(),
        tv: 0,
    };
    let req = crate::api::agent::ProcessRequest {
        input: "Inspect the attached image".into(),
        context: Some(crate::api::agent::ProcessContext {
            custom_data: Some(json!({"attachments": [{"url": image.content_path}]})),
            ..Default::default()
        }),
    };
    assert_eq!(
        crate::services::agent::run_hub::user_executing_run_count(user_id).await,
        0
    );
    let result = crate::api::agent::start_process_run(f.db.clone(), claims, req).await;
    match result {
        Err(error) => assert_eq!(error.0.code(), Some("MEDIA_STORE_FAILED")),
        Ok(run) => {
            run.abort_execution().await;
            panic!("failed media reference must not start a run");
        }
    }
    assert_eq!(
        crate::services::agent::run_hub::user_executing_run_count(user_id).await,
        0
    );
    assert_eq!(active_count(&f.db, image.id).await.unwrap(), 0);
    f.close().await;
}

#[tokio::test]
async fn postgres_automatic_upgrade_starts_retries_resumes_and_stops() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let paths = LegacyPaths {
        federation_root: f.service.store().root().join("old"),
        cache_images: f.service.store().root().join("cache"),
    };
    f.db.execute_unprepared("INSERT INTO media_assets(kind,url,mime,name,size) VALUES ('upload','/media/federation/1/automatic.png','image/png','automatic.png',0)").await.unwrap();
    let now = chrono::Utc::now().timestamp();
    // A second replica must return immediately while an admin/worker owns the job.
    let lock = f.db.begin().await.unwrap();
    lock.execute_unprepared(
        "SELECT pg_advisory_xact_lock(hashtextextended('media:upgrade:v2', 0))",
    )
    .await
    .unwrap();
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            upgrade::automatic_step(&f.db, f.service.store(), &paths, &[], now)
        )
        .await
        .unwrap()
        .unwrap()
        .is_none()
    );
    lock.rollback().await.unwrap();
    // No admin request creates or advances this job.
    let mut progress = upgrade::UpgradeProgress::default();
    for _ in 0..40 {
        progress = upgrade::automatic_step(&f.db, f.service.store(), &paths, &[], now)
            .await
            .unwrap()
            .unwrap();
        if progress.error.is_some() {
            break;
        }
    }
    assert_eq!(progress.error.as_deref(), Some("MEDIA_MISSING"));
    assert_eq!(progress.consecutive_failures, 1);
    assert_eq!(progress.next_retry_at, Some(now + 60));
    let cursor = (
        progress.pass,
        progress.phase,
        progress.after.clone(),
        progress.scanned,
    );
    assert!(
        upgrade::automatic_step(&f.db, f.service.store(), &paths, &[], now + 59)
            .await
            .unwrap()
            .is_none()
    );
    // A new handle reads durable backoff and cursor, as a restarted process would.
    let resumed = MediaStore::new(f.service.store().root().to_path_buf());
    let second = upgrade::automatic_step(&f.db, &resumed, &paths, &[], now + 60)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            second.pass,
            second.phase,
            second.after.clone(),
            second.scanned
        ),
        cursor
    );
    assert_eq!(second.consecutive_failures, 2);
    assert_eq!(second.next_retry_at, Some(now + 180));
    tokio::fs::create_dir_all(paths.federation_root.join("1"))
        .await
        .unwrap();
    tokio::fs::write(paths.federation_root.join("1/automatic.png"), png())
        .await
        .unwrap();
    for _ in 0..40 {
        progress = upgrade::automatic_step(&f.db, &resumed, &paths, &[], now + 180)
            .await
            .unwrap()
            .unwrap();
        assert!(progress.error.is_none());
        assert_eq!(progress.consecutive_failures, 0);
        if progress.complete {
            break;
        }
    }
    assert!(progress.complete);
    assert!(
        upgrade::automatic_step(&f.db, &resumed, &paths, &[], now + 3600)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        upgrade::status(&f.db).await.unwrap().scanned,
        progress.scanned
    );
    assert!(
        paths.federation_root.join("1/automatic.png").exists(),
        "source is retained"
    );
    f.close().await;
}
