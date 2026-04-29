use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use pawscope_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus,
};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

const ACTIVE_WINDOW_SECS: i64 = 300;

pub struct CodexAdapter {
    db_path: PathBuf,
    conn: Arc<Mutex<Connection>>,
}

impl CodexAdapter {
    pub fn new() -> Result<Self> {
        let dir = std::env::var("CODEX_STATE_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
            .ok_or_else(|| CoreError::NotFound("codex state dir".into()))?;
        let db_path = Self::resolve_db_path(&dir)?;
        Self::with_db(db_path)
    }

    pub fn with_db(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path).map_err(|e| CoreError::Other(e.to_string()))?;
        Ok(Self {
            db_path,
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn resolve_db_path(dir: &Path) -> Result<PathBuf> {
        // Pick the highest-numbered state_*.sqlite (e.g. state_5.sqlite).
        let mut best: Option<(u32, PathBuf)> = None;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for ent in entries.flatten() {
                let p = ent.path();
                let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if let Some(rest) = name
                    .strip_prefix("state_")
                    .and_then(|s| s.strip_suffix(".sqlite"))
                {
                    if let Ok(n) = rest.parse::<u32>() {
                        if best.as_ref().map(|(b, _)| n > *b).unwrap_or(true) {
                            best = Some((n, p.clone()));
                        }
                    }
                }
            }
        }
        best.map(|(_, p)| p)
            .ok_or_else(|| CoreError::NotFound(format!("state_*.sqlite in {}", dir.display())))
    }
}

fn parse_repo_from_origin(origin: Option<&str>) -> Option<String> {
    let o = origin?.trim();
    if o.is_empty() {
        return None;
    }
    let cleaned = o.trim_end_matches(".git");
    // SSH form: git@github.com:owner/repo
    if let Some((_, tail)) = cleaned.rsplit_once(':') {
        if tail.contains('/') && !tail.contains("//") {
            return Some(tail.trim_start_matches('/').to_string());
        }
    }
    // HTTPS form: https://host/owner/repo[/...]
    let path = cleaned.split("://").nth(1).unwrap_or(cleaned);
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 3 {
        return Some(format!(
            "{}/{}",
            parts[parts.len() - 2],
            parts[parts.len() - 1]
        ));
    }
    None
}

#[async_trait]
impl AgentAdapter for CodexAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let conn = self.conn.clone();
        let rows = tokio::task::spawn_blocking(move || -> Result<Vec<SessionMeta>> {
            let guard = conn.lock().unwrap();
            let mut stmt = guard
                .prepare(
                    "SELECT id, cwd, title, model, git_branch, git_origin_url,
                            archived, created_at, updated_at, first_user_message
                       FROM threads
                      WHERE archived = 0
                      ORDER BY updated_at DESC
                      LIMIT 500",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let now = Utc::now();
            let it = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, i64>(6)?,
                        r.get::<_, i64>(7)?,
                        r.get::<_, i64>(8)?,
                        r.get::<_, String>(9)?,
                    ))
                })
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let mut out = Vec::new();
            for r in it.flatten() {
                let (id, cwd, title, model, branch, origin, _archived, created, updated, fum) = r;
                let started_at: DateTime<Utc> =
                    Utc.timestamp_opt(created, 0).single().unwrap_or(now);
                let last_event_at: DateTime<Utc> =
                    Utc.timestamp_opt(updated, 0).single().unwrap_or(now);
                let active = (now - last_event_at).num_seconds() < ACTIVE_WINDOW_SECS;
                let status = if active {
                    SessionStatus::Active
                } else {
                    SessionStatus::Idle
                };
                let summary_src = if !title.trim().is_empty() { title } else { fum };
                let summary: String = summary_src.chars().take(80).collect();
                let repo = parse_repo_from_origin(origin.as_deref());
                out.push(SessionMeta {
                    id,
                    agent: AgentKind::Codex,
                    cwd: PathBuf::from(cwd),
                    repo,
                    branch,
                    summary,
                    model,
                    status,
                    pid: None,
                    started_at,
                    last_event_at,
                });
            }
            Ok(out)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(rows)
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        let conn = self.conn.clone();
        let id = session_id.to_string();
        let detail = tokio::task::spawn_blocking(move || -> Result<SessionDetail> {
            let (fum, created, rollout_path) = {
                let guard = conn.lock().unwrap();
                let mut stmt = guard
                    .prepare(
                        "SELECT first_user_message, created_at, rollout_path
                           FROM threads WHERE id = ?1",
                    )
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let mut rows = stmt
                    .query([&id])
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let Some(row) = rows.next().map_err(|e| CoreError::Other(e.to_string()))? else {
                    return Err(CoreError::NotFound(id));
                };
                let fum: String = row.get(0).unwrap_or_default();
                let created: i64 = row.get(1).unwrap_or(0);
                let rollout_path: String = row.get(2).unwrap_or_default();
                (fum, created, rollout_path)
            };

            let mut detail = SessionDetail::default();
            let fum_for_fallback = fum.clone();
            let fum_first_prompt = !fum.trim().is_empty();
            if fum_first_prompt {
                let snippet: String = fum.chars().take(120).collect();
                detail.prompts.push(pawscope_core::PromptSummary {
                    id: "first".into(),
                    timestamp: Utc.timestamp_opt(created, 0).single(),
                    snippet,
                    text: fum,
                });
            }

            let mut parsed = false;
            if !rollout_path.is_empty() {
                let path = PathBuf::from(&rollout_path);
                if let Ok(file) = std::fs::File::open(&path) {
                    let prompts_before = detail.prompts.len();
                    parse_rollout_into_detail(file, &mut detail);
                    // If rollout produced its own user prompts, drop the
                    // DB-derived "first" placeholder to avoid duplication.
                    if detail.prompts.len() > prompts_before && fum_first_prompt {
                        detail.prompts.remove(0);
                    }
                    parsed = true;
                }
            }
            // Fallback: when rollout file unavailable, surface the first user
            // message as a single user_messages count so the UI shows non-zero
            // activity instead of an empty session.
            if !parsed && detail.user_messages == 0 && !fum_for_fallback.trim().is_empty() {
                detail.user_messages = 1;
            }
            Ok(detail)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(detail)
    }

    async fn session_activity_hourly(&self, session_id: &str, hours: u32) -> Result<Vec<u64>> {
        let conn = self.conn.clone();
        let id = session_id.to_string();
        let hours_usize = hours as usize;
        let buckets = tokio::task::spawn_blocking(move || -> Result<Vec<u64>> {
            let rollout_path: String = {
                let guard = conn.lock().unwrap();
                let mut stmt = guard
                    .prepare("SELECT rollout_path FROM threads WHERE id = ?1")
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let mut rows = stmt
                    .query([&id])
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                match rows.next().map_err(|e| CoreError::Other(e.to_string()))? {
                    Some(r) => r.get::<_, String>(0).unwrap_or_default(),
                    None => return Ok(Vec::new()),
                }
            };
            if rollout_path.is_empty() {
                return Ok(Vec::new());
            }
            let file = match std::fs::File::open(&rollout_path) {
                Ok(f) => f,
                Err(_) => return Ok(Vec::new()),
            };
            Ok(parse_rollout_activity(file, hours_usize))
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(buckets)
    }

    async fn watch(&self, _tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        // Polling-based watch: refresh sessions every 5s by emitting
        // SessionListChanged whenever the DB mtime advances.
        let path = self.db_path.clone();
        let tx = _tx;
        tokio::spawn(async move {
            let mut last_mtime: Option<std::time::SystemTime> = None;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                let cur = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
                if cur != last_mtime {
                    last_mtime = cur;
                    if tx.send(SessionEvent::SessionListChanged).await.is_err() {
                        break;
                    }
                }
            }
        });
        Ok(())
    }
}

fn parse_rollout_into_detail(file: std::fs::File, detail: &mut SessionDetail) {
    use pawscope_core::types::ToolCall;
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(file);
    for line in reader.lines().map_while(std::result::Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let payload = v.get("payload");
        let ts = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));
        let record_tool = |detail: &mut SessionDetail, name: &str| {
            *detail.tools_used.entry(name.to_string()).or_default() += 1;
            if let Some(ts) = ts {
                detail.tool_calls.push(ToolCall {
                    name: name.to_string(),
                    timestamp: ts,
                });
            }
        };
        match kind {
            "response_item" => {
                let Some(p) = payload else { continue };
                let inner = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match inner {
                    "message" => {
                        let role = p.get("role").and_then(|r| r.as_str()).unwrap_or("");
                        match role {
                            "user" => {
                                detail.user_messages += 1;
                                if let Some(text) = extract_user_text(p) {
                                    let idx = detail.prompts.len();
                                    let snippet: String = text.chars().take(120).collect();
                                    detail.prompts.push(pawscope_core::PromptSummary {
                                        id: format!("u-{idx}"),
                                        timestamp: ts,
                                        snippet,
                                        text,
                                    });
                                }
                            }
                            "assistant" => {
                                detail.assistant_messages += 1;
                                detail.turns += 1;
                            }
                            _ => {}
                        }
                    }
                    "function_call" => {
                        let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("function");
                        record_tool(detail, name);
                    }
                    "custom_tool_call" => {
                        let name = p
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("custom_tool");
                        record_tool(detail, name);
                    }
                    "local_shell_call" => {
                        record_tool(detail, "shell");
                    }
                    _ => {}
                }
            }
            "compacted" => {
                // mid-session compaction; ignore but don't error.
            }
            "event_msg" => {
                // Codex emits cumulative token totals as event_msg/token_count.
                // The latest occurrence wins (each event reports total-so-far).
                let Some(p) = payload else { continue };
                if p.get("type").and_then(|t| t.as_str()) == Some("token_count") {
                    if let Some(usage) = p.pointer("/info/total_token_usage") {
                        if let Some(n) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                            detail.tokens_in = n;
                        }
                        if let Some(n) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                            detail.tokens_out = n;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Extract user-typed text from a Codex message payload. Codex (Responses
/// API) wraps user content as `[{type:"input_text",text:"..."}]`. Some older
/// rollouts use plain `[{type:"text",text:"..."}]` or a string. We also skip
/// system-reminder / tool-output blocks that aren't real user prompts.
fn extract_user_text(payload: &serde_json::Value) -> Option<String> {
    let content = payload.get("content")?;
    if let Some(s) = content.as_str() {
        let t = s.trim();
        return (!t.is_empty()).then(|| t.to_string());
    }
    let arr = content.as_array()?;
    let mut out = String::new();
    for item in arr {
        let kind = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if !matches!(kind, "input_text" | "text") {
            continue;
        }
        if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(t);
        }
    }
    let trimmed = out.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn parse_rollout_activity(file: std::fs::File, hours: usize) -> Vec<u64> {
    use std::io::{BufRead, BufReader};
    if hours == 0 {
        return Vec::new();
    }
    let mut buckets = vec![0u64; hours];
    let now = Utc::now();
    let reader = BufReader::new(file);
    for line in reader.lines().map_while(std::result::Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Only count assistant messages as turns (matches Claude semantics).
        let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if kind != "response_item" {
            continue;
        }
        let payload = match v.get("payload") {
            Some(p) => p,
            None => continue,
        };
        if payload.get("type").and_then(|t| t.as_str()) != Some("message")
            || payload.get("role").and_then(|r| r.as_str()) != Some("assistant")
        {
            continue;
        }
        let ts_str = match v.get("timestamp").and_then(|t| t.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let ts = match DateTime::parse_from_rfc3339(ts_str) {
            Ok(t) => t.with_timezone(&Utc),
            Err(_) => continue,
        };
        let hours_ago = (now - ts).num_hours();
        if hours_ago < 0 {
            continue;
        }
        let hours_ago = hours_ago as usize;
        if hours_ago >= hours {
            continue;
        }
        let idx = hours - 1 - hours_ago;
        buckets[idx] += 1;
    }
    buckets
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_db() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("state_5.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                model_provider TEXT NOT NULL DEFAULT '',
                cwd TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                sandbox_policy TEXT NOT NULL DEFAULT '',
                approval_mode TEXT NOT NULL DEFAULT '',
                tokens_used INTEGER NOT NULL DEFAULT 0,
                has_user_event INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                git_branch TEXT,
                git_origin_url TEXT,
                first_user_message TEXT NOT NULL DEFAULT '',
                model TEXT
            );",
        )
        .unwrap();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO threads (id, created_at, updated_at, cwd, title, archived, git_branch, git_origin_url, first_user_message, model)
             VALUES (?1, ?2, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                "thread-1",
                now,
                "/Users/me/proj",
                "Refactor auth module",
                "main",
                "git@github.com:acme/proj.git",
                "Help me refactor the auth flow.",
                "gpt-5",
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, created_at, updated_at, cwd, title, archived, first_user_message)
             VALUES ('thread-archived', ?1, ?1, '/x', 'archived', 1, 'old')",
            [now - 86400],
        )
        .unwrap();
        (dir, db)
    }

    #[tokio::test]
    async fn lists_active_threads_with_metadata() {
        let (_dir, db) = build_db();
        let a = CodexAdapter::with_db(db).unwrap();
        let s = a.list_sessions().await.unwrap();
        assert_eq!(s.len(), 1, "archived rows must be excluded");
        let m = &s[0];
        assert_eq!(m.id, "thread-1");
        assert_eq!(m.repo.as_deref(), Some("acme/proj"));
        assert_eq!(m.branch.as_deref(), Some("main"));
        assert_eq!(m.model.as_deref(), Some("gpt-5"));
        assert_eq!(m.summary, "Refactor auth module");
        assert!(matches!(m.agent, AgentKind::Codex));
    }

    #[tokio::test]
    async fn detail_surfaces_first_prompt() {
        let (_dir, db) = build_db();
        let a = CodexAdapter::with_db(db).unwrap();
        let d = a.get_detail("thread-1").await.unwrap();
        assert_eq!(d.user_messages, 1);
        assert_eq!(d.prompts.len(), 1);
        assert_eq!(d.prompts[0].text, "Help me refactor the auth flow.");
    }

    #[test]
    fn origin_parser_handles_ssh_and_https() {
        assert_eq!(
            parse_repo_from_origin(Some("git@github.com:owner/repo.git")).as_deref(),
            Some("owner/repo")
        );
        assert_eq!(
            parse_repo_from_origin(Some("https://github.com/owner/repo")).as_deref(),
            Some("owner/repo")
        );
        assert_eq!(parse_repo_from_origin(None), None);
        assert_eq!(parse_repo_from_origin(Some("")), None);
    }

    fn write_rollout(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, lines.join("\n")).unwrap();
        p
    }

    #[tokio::test]
    async fn detail_parses_rollout_messages_and_tools() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = |secs: i64| (now - chrono::Duration::seconds(secs)).to_rfc3339();
        let rollout = write_rollout(
            dir.path(),
            "rollout-thread-2.jsonl",
            &[
                &format!(
                    r#"{{"timestamp":"{}","type":"session_meta","payload":{{"meta":{{}}}}}}"#,
                    ts(60)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[]}}}}"#,
                    ts(50)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"function_call","name":"shell","arguments":"","call_id":"c1"}}}}"#,
                    ts(40)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"local_shell_call","status":"completed","action":{{}}}}}}"#,
                    ts(30)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"custom_tool_call","name":"web_search","input":"","call_id":"c2"}}}}"#,
                    ts(20)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"assistant","content":[]}}}}"#,
                    ts(10)
                ),
            ],
        );

        let db = dir.path().join("state_5.sqlite");
        let conn = Connection::open(&db).unwrap();
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
        let now_secs = now.timestamp();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, first_user_message)
             VALUES ('thread-2', ?1, ?2, ?2, '/x', 'hi')",
            rusqlite::params![rollout.to_string_lossy(), now_secs],
        )
        .unwrap();
        drop(conn);

        let a = CodexAdapter::with_db(db).unwrap();
        let d = a.get_detail("thread-2").await.unwrap();
        assert_eq!(d.user_messages, 1);
        assert_eq!(d.assistant_messages, 1);
        assert_eq!(d.turns, 1);
        assert_eq!(d.tools_used.get("shell").copied(), Some(2));
        assert_eq!(d.tools_used.get("web_search").copied(), Some(1));

        let buckets = a.session_activity_hourly("thread-2", 24).await.unwrap();
        // The single assistant message lands in the most-recent hour bucket.
        assert_eq!(buckets.len(), 24);
        assert_eq!(buckets[23], 1);
        assert_eq!(buckets[..23].iter().sum::<u64>(), 0);
    }

    #[tokio::test]
    async fn detail_handles_missing_rollout_file_gracefully() {
        let (_dir, db) = build_db();
        let a = CodexAdapter::with_db(db).unwrap();
        let d = a.get_detail("thread-1").await.unwrap();
        // rollout_path is empty so we fall back to first-user-message stub.
        assert_eq!(d.user_messages, 1);
        assert_eq!(d.assistant_messages, 0);
    }

    #[tokio::test]
    async fn detail_extracts_all_user_prompts_from_rollout() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = |secs: i64| (now - chrono::Duration::seconds(secs)).to_rfc3339();
        let rollout = write_rollout(
            dir.path(),
            "rollout-thread-3.jsonl",
            &[
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"first prompt"}}]}}}}"#,
                    ts(50)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"assistant","content":[{{"type":"output_text","text":"ok"}}]}}}}"#,
                    ts(40)
                ),
                &format!(
                    r#"{{"timestamp":"{}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"follow-up question"}}]}}}}"#,
                    ts(30)
                ),
            ],
        );
        let db = dir.path().join("state_5.sqlite");
        let conn = Connection::open(&db).unwrap();
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
             VALUES ('thread-3', ?1, ?2, ?2, '/x', 'first prompt')",
            rusqlite::params![rollout.to_string_lossy(), now.timestamp()],
        )
        .unwrap();
        drop(conn);

        let a = CodexAdapter::with_db(db).unwrap();
        let d = a.get_detail("thread-3").await.unwrap();
        assert_eq!(d.user_messages, 2);
        assert_eq!(d.prompts.len(), 2, "should extract both user prompts");
        assert_eq!(d.prompts[0].text, "first prompt");
        assert_eq!(d.prompts[1].text, "follow-up question");
        assert!(d.prompts[0].timestamp.is_some());
    }

    #[tokio::test]
    async fn detail_extracts_token_usage_from_rollout() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = |secs: i64| (now - chrono::Duration::seconds(secs)).to_rfc3339();
        let rollout = write_rollout(
            dir.path(),
            "rollout-thread-4.jsonl",
            &[
                &format!(
                    r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":100,"output_tokens":50,"total_tokens":150}},"model_context_window":256000}}}}}}"#,
                    ts(40)
                ),
                // Cumulative — second event should overwrite the first.
                &format!(
                    r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":250,"output_tokens":120,"total_tokens":370}},"model_context_window":256000}}}}}}"#,
                    ts(20)
                ),
            ],
        );
        let db = dir.path().join("state_5.sqlite");
        let conn = Connection::open(&db).unwrap();
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
             VALUES ('thread-4', ?1, ?2, ?2, '/x', '')",
            rusqlite::params![rollout.to_string_lossy(), now.timestamp()],
        )
        .unwrap();
        drop(conn);

        let a = CodexAdapter::with_db(db).unwrap();
        let d = a.get_detail("thread-4").await.unwrap();
        assert_eq!(d.tokens_in, 250);
        assert_eq!(d.tokens_out, 120);
    }
}
