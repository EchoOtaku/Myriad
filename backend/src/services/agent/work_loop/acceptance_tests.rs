//! Business acceptance uses real handlers and an isolated PostgreSQL database.
//! Only model HTTP responses are scripted; observations and writes are real.
use super::*;
use crate::models::entities::{phantasi_items, phantasi_sources, tapp_storage};
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, Schema, Statement};

pub(super) async fn business_database(user: i32) -> sea_orm::DatabaseConnection {
    let db = tests::test_database().await;
    let schema = Schema::new(DatabaseBackend::Postgres);
    for statement in [
        schema.create_table_from_entity(phantasi_sources::Entity).if_not_exists().to_owned(),
        schema.create_table_from_entity(phantasi_items::Entity).if_not_exists().to_owned(),
        schema.create_table_from_entity(tapp_storage::Entity).if_not_exists().to_owned(),
    ] {
        db.execute_raw(DatabaseBackend::Postgres.build(&statement)).await.unwrap();
    }
    db.execute_raw(Statement::from_string(DatabaseBackend::Postgres,
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, is_admin BOOLEAN NOT NULL)")).await.unwrap();
    db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "INSERT INTO users VALUES ($1,true) ON CONFLICT(id) DO UPDATE SET is_admin=true", [user.into()])).await.unwrap();
    tapp_storage::Entity::delete_many().filter(tapp_storage::Column::UserId.eq(user)).exec(&db).await.unwrap();
    db
}

pub(super) fn state_for(user: i32) -> Checkpoint {
    let mut state = tests::checkpoint();
    state.user_id = user;
    state.request.user_id = user;
    state
}

pub(super) fn call(id: &str, capability: &str, arguments: Value) -> PendingCall {
    PendingCall { call: ToolCall { id: id.into(), name: tools::tool_name(capability), arguments: arguments.to_string() },
        capability_id: Some(capability.into()), approval: None }
}

pub(super) fn sse_call(id: &str, name: &str, arguments: Value) -> Value {
    json!({"id":id,"type":"function","function":{"name":name,"arguments":arguments.to_string()}})
}

pub(super) fn sse(text: &str, calls: Vec<Value>) -> String {
    let calls: Vec<_> = calls.into_iter().enumerate().map(|(index, mut call)| {call["index"] = json!(index); call}).collect();
    let reason = if calls.is_empty() {"stop"} else {"tool_calls"};
    format!("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        json!({"choices":[{"delta":{"content":text,"tool_calls":calls},"finish_reason":reason}]}),
        json!({"choices":[],"usage":{"prompt_tokens":300,"completion_tokens":30,"total_tokens":330}}))
}

pub(super) async fn model(app: axum::Router) -> (crate::services::analyzer::AiAnalyzer, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let analyzer = crate::services::analyzer::AiAnalyzer::new(crate::services::analyzer::AiProvider::OpenAI,
        "test-only".into(), "test-model".into(), Some(format!("http://{address}/v1"))).await;
    (analyzer, task)
}

pub(super) async fn article_fixture(db: &sea_orm::DatabaseConnection, user: i32) -> Vec<String> {
    let row = db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "INSERT INTO phantasi_sources(user_id,name,url,feed_type,source_type,update_interval,error_count,enabled,item_count,unread_count,admin_only,created_at,updated_at) VALUES ($1,'Work acceptance','https://example.invalid/feed','rss','rss',60,0,true,3,3,false,NOW(),NOW()) RETURNING id",
        [user.into()])).await.unwrap().unwrap();
    let source: i32 = row.try_get("", "id").unwrap();
    let mut facts = Vec::new();
    for index in 0..3 {
        let fact = format!("Verified fact {}: {}", index, uuid::Uuid::new_v4());
        let guid = format!("work-{user}-{source}-{index}");
        db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
            "INSERT INTO phantasi_items(source_id,guid,title,link,content,published_at,fetched_at,fulltext_fetched,content_revision) VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),true,1)",
            [source.into(), guid.into(), format!("Work acceptance Rust {index}").into(), format!("https://example.invalid/{source}/{index}").into(), fact.clone().into()])).await.unwrap();
        facts.push(fact);
    }
    facts
}

async fn search_read_save(steer: bool) {
    let user = if steer {8482} else {8481};
    let db = business_database(user).await;
    // No earlier fixture can affect the bounded search result set.
    db.execute_raw(Statement::from_string(DatabaseBackend::Postgres, "DELETE FROM phantasi_items")).await.unwrap();
    db.execute_raw(Statement::from_string(DatabaseBackend::Postgres, "DELETE FROM phantasi_sources")).await.unwrap();
    let facts = article_fixture(&db, user).await;
    let mut state = state_for(user);
    let task_id = state.task.task_id.clone();
    let server_db = db.clone();
    let app = axum::Router::new().route("/v1/chat/completions", axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
        let db = server_db.clone();
        let task_id = task_id.clone();
        async move {
            let messages = body["messages"].as_array().unwrap();
            let results: Vec<Value> = messages.iter().filter(|m| m["role"] == "tool")
                .map(|m| serde_json::from_str(m["content"].as_str().unwrap()).unwrap()).collect();
            let corrected = messages.iter().any(|m| m["role"] == "user" && m["content"].as_str().unwrap_or("").contains("Do not save"));
            let response = if corrected { sse("Stopped before saving, as requested.", vec![]) } else {
                match results.len() {
                    0 => sse("", vec![sse_call("discover", "discover_tools", json!({"ids":["search.fuzzy","phantasi.article","note.create"]}))]),
                    1 => sse("", vec![sse_call("empty", &tools::tool_name("search.fuzzy"), json!({"query":"zzzzzzzzzzzzzzzzzz","scope":"phantasi","type":"item"}))]),
                    2 => {
                        assert_eq!(results[1]["total"], 0);
                        sse("", vec![sse_call("search", &tools::tool_name("search.fuzzy"), json!({"query":"Work acceptance Rust","scope":"phantasi","type":"item","limit":3}))])
                    }
                    3 => {
                        let found = results[2]["results"].as_array().unwrap();
                        assert_eq!(found.len(), 3);
                        sse("", found.iter().enumerate().map(|(index, item)| sse_call(&format!("read-{index}"), &tools::tool_name("phantasi.article"), json!({"articleId":item["id"]}))).collect())
                    }
                    6 => {
                        let content = results[3..].iter().map(|r| r["plainText"].as_str().unwrap()).collect::<Vec<_>>().join("\n");
                        if steer { executor::enqueue_steering(&db, &task_id, "Do not save; just summarize.".into()).await.unwrap(); }
                        sse("", vec![sse_call("save", &tools::tool_name("note.create"), json!({"title":"Acceptance summary","content":content}))])
                    }
                    7 => { assert_eq!(results[6]["success"], true); sse("Saved the verified article facts.", vec![]) }
                    _ => panic!("unexpected model conversation"),
                }
            };
            ([("content-type","text/event-stream")], response)
        }
    }));
    let (analyzer, server) = model(app).await;
    store::save(&db, &mut state).await.unwrap();
    Agent::new(db.clone()).await.drive_work_loop(&mut state, None, &executor::events::StepEventEmitter::new(None), &analyzer).await.unwrap();
    server.abort();
    assert_eq!(state.task.status, TaskStatus::Completed);
    let notes = tapp_storage::Entity::find().filter(tapp_storage::Column::UserId.eq(user))
        .filter(tapp_storage::Column::TappId.eq("agent_notes")).all(&db).await.unwrap();
    assert_eq!(notes.len(), if steer {0} else {1});
    if steer {
        assert!(!state.task.step_results["save"].success);
    } else {
        for fact in facts { assert!(notes[0].value["content"].as_str().unwrap().contains(&fact)); }
        assert_eq!(state.task.step_results["save"].output.as_ref().unwrap()["noteId"], notes[0].key);
    }
}

#[tokio::test]
#[ignore = "requires isolated myriad_work_loop_test"]
async fn postgres_empty_search_revises_query_reads_articles_and_persists_note() { search_read_save(false).await; }

#[tokio::test]
#[ignore = "requires isolated myriad_work_loop_test"]
async fn postgres_steering_stops_a_model_proposed_note_before_writing() { search_read_save(true).await; }
