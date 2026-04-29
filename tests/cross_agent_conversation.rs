//! Cross-agent integration tests for the Conversation Flow API.
//!
//! Asserts that a `MultiAdapter` composed of Claude + Codex routes
//! `get_conversation` to the right backend and returns the expected
//! shape for each agent.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use pawscope_claude::ClaudeAdapter;
use pawscope_codex::CodexAdapter;
use pawscope_core::{AgentAdapter, TurnItem};
use pawscope_server::multi::MultiAdapter;

/// Build a minimal Claude jsonl with one user prompt + one assistant
/// reply containing a tool call, plus a tool_result follow-up.
fn write_claude_session(root: &std::path::Path, session_id: &str) -> PathBuf {
    let proj = root.join("-tmp-cross-agent");
    std::fs::create_dir_all(&proj).unwrap();
    let path = proj.join(format!("{session_id}.jsonl"));
    let lines = [
        format!(
            r#"{{"type":"user","uuid":"u1","timestamp":"{}","sessionId":"{}","message":{{"role":"user","content":"explain the codebase"}}}}"#,
            Utc::now().to_rfc3339(),
            session_id
        ),
        format!(
            r#"{{"type":"assistant","uuid":"a1","timestamp":"{}","sessionId":"{}","message":{{"id":"msg_1","role":"assistant","model":"claude-haiku-4-5","content":[{{"type":"text","text":"Sure, let me look."}},{{"type":"tool_use","id":"toolu_1","name":"grep","input":{{"pattern":"foo"}}}}]}}}}"#,
            Utc::now().to_rfc3339(),
            session_id
        ),
        format!(
            r#"{{"type":"user","uuid":"u2","timestamp":"{}","sessionId":"{}","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"toolu_1","content":"3 matches","is_error":false}}]}}}}"#,
            Utc::now().to_rfc3339(),
            session_id
        ),
    ];
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();
    path
}

/// Build a minimal Codex sqlite + rollout pair with one user, one
/// assistant message, and a function_call/output round-trip.
fn write_codex_session(root: &std::path::Path, thread_id: &str) -> PathBuf {
    let rollout = root.join(format!("{thread_id}.jsonl"));
    let now = Utc::now();
    let ts = |secs: i64| (now - chrono::Duration::seconds(secs)).to_rfc3339();
    let lines = [
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"hello codex"}}]}}}}"#,
            ts(40)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"assistant","content":[{{"type":"output_text","text":"hi from codex"}}]}}}}"#,
            ts(30)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"function_call","name":"shell","arguments":"pwd","call_id":"cx1"}}}}"#,
            ts(20)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"function_call_output","call_id":"cx1","output":"/tmp","status":"completed"}}}}"#,
            ts(10)
        ),
    ];
    std::fs::write(&rollout, format!("{}\n", lines.join("\n"))).unwrap();

    let db = root.join("state_5.sqlite");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            cwd TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            archived INTEGER NOT NULL DEFAULT 0,
            git_branch TEXT,
            git_origin_url TEXT,
            first_user_message TEXT NOT NULL DEFAULT '',
            model TEXT
        );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, first_user_message)
         VALUES (?1, ?2, ?3, ?3, '/x', '')",
        rusqlite::params![thread_id, rollout.to_string_lossy(), now.timestamp()],
    )
    .unwrap();
    drop(conn);
    db
}

#[tokio::test]
async fn multi_adapter_routes_conversation_to_claude() {
    let dir = tempfile::tempdir().unwrap();
    let claude_root = dir.path().join("claude_projects");
    std::fs::create_dir_all(&claude_root).unwrap();
    let claude_id = "11111111-1111-1111-1111-111111111111";
    write_claude_session(&claude_root, claude_id);

    let codex_dir = dir.path().join("codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_id = "thread-cx";
    let codex_db = write_codex_session(&codex_dir, codex_id);

    let claude = Arc::new(ClaudeAdapter::with_root(claude_root)) as Arc<dyn AgentAdapter>;
    let codex = Arc::new(CodexAdapter::with_db(codex_db).unwrap()) as Arc<dyn AgentAdapter>;
    let multi = MultiAdapter::new(vec![claude, codex]);

    let log = multi
        .get_conversation(claude_id)
        .await
        .unwrap()
        .expect("claude conversation should be present");

    assert_eq!(log.interactions.len(), 1, "one user prompt → one interaction");
    let i0 = &log.interactions[0];
    assert_eq!(i0.user_message_raw.as_deref(), Some("explain the codebase"));
    assert_eq!(i0.turns.len(), 1);
    let turn = &i0.turns[0];
    assert_eq!(turn.items.len(), 2, "[AssistantMessage, Tool]");

    match &turn.items[1] {
        TurnItem::Tool(tc) => {
            assert_eq!(tc.name, "grep");
            assert_eq!(tc.call_id, "toolu_1");
            assert_eq!(
                tc.result_snippet.as_deref(),
                Some("3 matches"),
                "tool_result should fill the matching tool item"
            );
            assert_eq!(tc.success, Some(true));
        }
        other => panic!("expected Tool second, got {other:?}"),
    }
}

#[tokio::test]
async fn multi_adapter_routes_conversation_to_codex() {
    let dir = tempfile::tempdir().unwrap();
    let claude_root = dir.path().join("claude_projects");
    std::fs::create_dir_all(&claude_root).unwrap();
    let claude_id = "22222222-2222-2222-2222-222222222222";
    write_claude_session(&claude_root, claude_id);

    let codex_dir = dir.path().join("codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_id = "thread-cx";
    let codex_db = write_codex_session(&codex_dir, codex_id);

    let claude = Arc::new(ClaudeAdapter::with_root(claude_root)) as Arc<dyn AgentAdapter>;
    let codex = Arc::new(CodexAdapter::with_db(codex_db).unwrap()) as Arc<dyn AgentAdapter>;
    let multi = MultiAdapter::new(vec![claude, codex]);

    let log = multi
        .get_conversation(codex_id)
        .await
        .unwrap()
        .expect("codex conversation should be present");

    assert_eq!(log.interactions.len(), 1);
    let i0 = &log.interactions[0];
    assert_eq!(i0.user_message_raw.as_deref(), Some("hello codex"));
    assert_eq!(i0.turns.len(), 1);
    let turn = &i0.turns[0];
    assert_eq!(turn.items.len(), 2, "[AssistantMessage, Tool]");
    match &turn.items[1] {
        TurnItem::Tool(tc) => {
            assert_eq!(tc.name, "shell");
            assert_eq!(tc.call_id, "cx1");
            assert_eq!(tc.result_snippet.as_deref(), Some("/tmp"));
            assert_eq!(tc.success, Some(true));
        }
        other => panic!("expected Tool second, got {other:?}"),
    }
}

#[tokio::test]
async fn multi_adapter_returns_none_for_unknown_session() {
    let dir = tempfile::tempdir().unwrap();
    let claude_root = dir.path().join("claude_projects");
    std::fs::create_dir_all(&claude_root).unwrap();

    let codex_dir = dir.path().join("codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_db = write_codex_session(&codex_dir, "thread-cx");

    let claude = Arc::new(ClaudeAdapter::with_root(claude_root)) as Arc<dyn AgentAdapter>;
    let codex = Arc::new(CodexAdapter::with_db(codex_db).unwrap()) as Arc<dyn AgentAdapter>;
    let multi = MultiAdapter::new(vec![claude, codex]);

    let log = multi.get_conversation("does-not-exist").await.unwrap();
    assert!(log.is_none(), "missing session should return Ok(None), not error");
}
