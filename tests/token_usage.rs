//! Cross-agent integration test for v0.8 token + cost rollup.
//!
//! Synthesises a Claude session with `message.usage` and a Codex session
//! with cumulative `event_msg/token_count` totals, mounts both behind a
//! `MultiAdapter`, and asserts:
//!
//! * each adapter populates `AssistantTurn.usage` with the correct deltas
//!   and a known model name;
//! * `compute_cost` produces a non-`None` cost for both turns;
//! * the conversation-level `tokens` rollup sums to the per-turn totals
//!   and groups under the normalised model key.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use pawscope_claude::ClaudeAdapter;
use pawscope_codex::CodexAdapter;
use pawscope_core::AgentAdapter;
use pawscope_server::multi::MultiAdapter;

fn write_claude_session_with_usage(root: &std::path::Path, session_id: &str) -> PathBuf {
    let proj = root.join("-tmp-token-cross-agent");
    std::fs::create_dir_all(&proj).unwrap();
    let path = proj.join(format!("{session_id}.jsonl"));
    let lines = [
        format!(
            r#"{{"type":"user","uuid":"u1","timestamp":"{}","sessionId":"{}","message":{{"role":"user","content":"hi"}}}}"#,
            Utc::now().to_rfc3339(),
            session_id
        ),
        format!(
            r#"{{"type":"assistant","uuid":"a1","timestamp":"{}","sessionId":"{}","message":{{"id":"msg_1","role":"assistant","model":"claude-sonnet-4-5-20250929","content":[{{"type":"text","text":"hello"}}],"usage":{{"input_tokens":1200,"output_tokens":480,"cache_read_input_tokens":800,"cache_creation_input_tokens":400}}}}}}"#,
            Utc::now().to_rfc3339(),
            session_id
        ),
    ];
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();
    path
}

fn write_codex_session_with_token_count(root: &std::path::Path, thread_id: &str) -> PathBuf {
    let rollout = root.join(format!("{thread_id}.jsonl"));
    let now = Utc::now();
    let ts = |secs: i64| (now - chrono::Duration::seconds(secs)).to_rfc3339();
    let lines = [
        format!(
            r#"{{"timestamp":"{}","type":"session_meta","payload":{{"meta":{{"model":"gpt-5-codex"}}}}}}"#,
            ts(60)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"first"}}]}}}}"#,
            ts(50)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"assistant","content":[{{"type":"output_text","text":"r1"}}]}}}}"#,
            ts(45)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":100,"output_tokens":50,"total_tokens":150}}}}}}}}"#,
            ts(40)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"second"}}]}}}}"#,
            ts(30)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"assistant","content":[{{"type":"output_text","text":"r2"}}]}}}}"#,
            ts(25)
        ),
        format!(
            r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":350,"output_tokens":170,"total_tokens":520}}}}}}}}"#,
            ts(20)
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
        "INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, first_user_message, model)
         VALUES (?1, ?2, ?3, ?3, '/x', '', 'gpt-5-codex')",
        rusqlite::params![thread_id, rollout.to_string_lossy(), now.timestamp()],
    )
    .unwrap();
    drop(conn);
    db
}

#[tokio::test]
async fn claude_per_turn_usage_and_rollup() {
    let dir = tempfile::tempdir().unwrap();
    let claude_root = dir.path().join("claude_projects");
    std::fs::create_dir_all(&claude_root).unwrap();
    let claude_id = "33333333-3333-3333-3333-333333333333";
    write_claude_session_with_usage(&claude_root, claude_id);

    let codex_dir = dir.path().join("codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_db = write_codex_session_with_token_count(&codex_dir, "thread-tok");

    let claude = Arc::new(ClaudeAdapter::with_root(claude_root)) as Arc<dyn AgentAdapter>;
    let codex = Arc::new(CodexAdapter::with_db(codex_db).unwrap()) as Arc<dyn AgentAdapter>;
    let multi = MultiAdapter::new(vec![claude, codex]);

    let log = multi
        .get_conversation(claude_id)
        .await
        .unwrap()
        .expect("claude conversation should be present");

    let turn = &log.interactions[0].turns[0];
    let u = turn.usage.as_ref().expect("claude turn must carry usage");
    assert_eq!(u.input_tokens, Some(1200));
    assert_eq!(u.output_tokens, Some(480));
    assert_eq!(u.cache_read_tokens, Some(800));
    assert_eq!(u.cache_write_tokens, Some(400));
    assert!(
        u.cost_usd.unwrap() > 0.0,
        "claude cost must resolve from dated model"
    );
    assert!(u.model.contains("claude-sonnet-4-5"));

    // Rollup: single Claude turn → totals match per-turn values.
    let s = log.tokens.as_ref().expect("claude rollup must be Some");
    assert_eq!(s.turn_count, 1);
    assert_eq!(s.total_input_tokens, 1200);
    assert_eq!(s.total_output_tokens, 480);
    assert_eq!(s.total_cache_read_tokens, 800);
    assert_eq!(s.total_cache_write_tokens, 400);
    assert_eq!(
        s.turns_with_known_model, 1,
        "dated suffix should still resolve"
    );
    assert!(s.by_model.contains_key("claude-sonnet-4-5"));
    assert!(s.total_cost_usd.unwrap() > 0.0);
}

#[tokio::test]
async fn codex_token_deltas_and_rollup() {
    let dir = tempfile::tempdir().unwrap();
    let claude_root = dir.path().join("claude_projects");
    std::fs::create_dir_all(&claude_root).unwrap();

    let codex_dir = dir.path().join("codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_id = "thread-tok";
    let codex_db = write_codex_session_with_token_count(&codex_dir, codex_id);

    let claude = Arc::new(ClaudeAdapter::with_root(claude_root)) as Arc<dyn AgentAdapter>;
    let codex = Arc::new(CodexAdapter::with_db(codex_db).unwrap()) as Arc<dyn AgentAdapter>;
    let multi = MultiAdapter::new(vec![claude, codex]);

    let log = multi
        .get_conversation(codex_id)
        .await
        .unwrap()
        .expect("codex conversation should be present");

    assert_eq!(log.interactions.len(), 2);
    let t0 = log.interactions[0].turns[0]
        .usage
        .as_ref()
        .expect("codex turn 0 must carry usage from first token_count event");
    assert_eq!(t0.input_tokens, Some(100), "first delta = 100 - 0");
    assert_eq!(t0.output_tokens, Some(50));
    assert_eq!(t0.model, "gpt-5-codex");
    assert!(t0.cost_usd.unwrap() > 0.0);

    let t1 = log.interactions[1].turns[0]
        .usage
        .as_ref()
        .expect("codex turn 1 must carry usage delta");
    assert_eq!(t1.input_tokens, Some(250), "delta = 350 - 100");
    assert_eq!(t1.output_tokens, Some(120), "delta = 170 - 50");

    let s = log.tokens.as_ref().expect("codex rollup must be Some");
    assert_eq!(s.turn_count, 2);
    assert_eq!(
        s.total_input_tokens, 350,
        "matches latest cumulative input total"
    );
    assert_eq!(s.total_output_tokens, 170);
    assert_eq!(s.turns_with_known_model, 2);
    assert!(s.by_model.contains_key("gpt-5-codex"));
}
