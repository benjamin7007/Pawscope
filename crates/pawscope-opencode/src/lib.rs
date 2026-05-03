//! OpenCode adapter — reads SQLite from `~/.local/share/opencode/opencode.db`.
//!
//! Schema:
//! - `session`: id, project_id, directory, title, version, time_created, time_updated, time_archived
//! - `message`: id, session_id, time_created, data (JSON)
//! - `part`: id, message_id, session_id, time_created, data (JSON)
//!
//! Message data.role = "user" | "assistant". Assistant messages carry token counts
//! and model info. Parts contain text content, tool calls, and step boundaries.

use async_trait::async_trait;
use chrono::{DateTime, Local, TimeZone, Timelike, Utc};
use pawscope_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus, ToolCall,
};
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

const ACTIVE_WINDOW_SECS: i64 = 300;

pub struct OpenCodeAdapter {
    db_path: PathBuf,
    conn: Arc<Mutex<Connection>>,
}

impl OpenCodeAdapter {
    pub fn new() -> Result<Self> {
        let db_path = std::env::var("OPENCODE_STATE_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| {
                // OpenCode uses XDG_DATA_HOME, which defaults to ~/.local/share
                let xdg = std::env::var("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .ok()
                    .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))?;
                Some(xdg.join("opencode").join("opencode.db"))
            })
            .ok_or_else(|| CoreError::NotFound("opencode state dir".into()))?;

        if !db_path.exists() {
            return Err(CoreError::NotFound(format!(
                "opencode db not found: {}",
                db_path.display()
            )));
        }

        Self::with_db(db_path)
    }

    pub fn with_db(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| CoreError::Other(e.to_string()))?;
        Ok(Self {
            db_path,
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

fn epoch_ms_to_utc(ms: i64) -> DateTime<Utc> {
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    Utc.timestamp_opt(secs, nsecs)
        .single()
        .unwrap_or_else(Utc::now)
}

/// Query the modelID from the first assistant message for a session.
fn query_model(conn: &Connection, session_id: &str) -> Option<String> {
    let mut stmt = conn
        .prepare(
            "SELECT data FROM message WHERE session_id = ?1
             ORDER BY time_created ASC LIMIT 50",
        )
        .ok()?;
    let rows = stmt
        .query_map([session_id], |r| r.get::<_, String>(0))
        .ok()?;
    for row in rows.flatten() {
        let v: serde_json::Value = match serde_json::from_str(&row) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("role").and_then(|r| r.as_str()) == Some("assistant") {
            if let Some(model) = v.get("modelID").and_then(|m| m.as_str()) {
                return Some(model.to_string());
            }
        }
    }
    None
}

#[async_trait]
impl AgentAdapter for OpenCodeAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let conn = self.conn.clone();
        let rows = tokio::task::spawn_blocking(move || -> Result<Vec<SessionMeta>> {
            let guard = conn.lock().unwrap();
            let mut stmt = guard
                .prepare(
                    "SELECT id, directory, title, time_created, time_updated
                       FROM session
                      WHERE time_archived IS NULL
                      ORDER BY time_updated DESC
                      LIMIT 500",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let now = Utc::now();
            let it = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let mut out = Vec::new();
            for r in it.flatten() {
                let (id, directory, title, created_ms, updated_ms) = r;
                let started_at = epoch_ms_to_utc(created_ms);
                let last_event_at = epoch_ms_to_utc(updated_ms);
                let active = (now - last_event_at).num_seconds() < ACTIVE_WINDOW_SECS;
                let status = if active {
                    SessionStatus::Active
                } else {
                    SessionStatus::Closed
                };
                let summary = title
                    .filter(|t| !t.trim().is_empty())
                    .map(|t| t.chars().take(80).collect())
                    .unwrap_or_default();
                let model = query_model(&guard, &id);
                out.push(SessionMeta {
                    id,
                    agent: AgentKind::OpenCode,
                    cwd: PathBuf::from(directory),
                    repo: None,
                    branch: None,
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
        let sid = session_id.to_string();
        let detail = tokio::task::spawn_blocking(move || -> Result<SessionDetail> {
            let guard = conn.lock().unwrap();

            // Verify session exists.
            let exists: bool = guard
                .prepare("SELECT 1 FROM session WHERE id = ?1")
                .and_then(|mut s| s.exists([&sid]))
                .map_err(|e| CoreError::Other(e.to_string()))?;
            if !exists {
                return Err(CoreError::NotFound(sid));
            }

            let mut detail = SessionDetail::default();
            let mut tokens_in: u64 = 0;
            let mut tokens_out: u64 = 0;

            // Parse messages.
            let mut msg_stmt = guard
                .prepare(
                    "SELECT id, data FROM message WHERE session_id = ?1
                     ORDER BY time_created ASC",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let msgs = msg_stmt
                .query_map([&sid], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| CoreError::Other(e.to_string()))?;

            for row in msgs.flatten() {
                let (_msg_id, data_str) = row;
                let v: serde_json::Value = match serde_json::from_str(&data_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let role = v.get("role").and_then(|r| r.as_str()).unwrap_or("");
                match role {
                    "user" => {
                        detail.user_messages += 1;
                    }
                    "assistant" => {
                        detail.assistant_messages += 1;
                        detail.turns += 1;
                        if let Some(tokens) = v.get("tokens") {
                            if let Some(n) = tokens.get("input").and_then(|x| x.as_u64()) {
                                tokens_in += n;
                            }
                            if let Some(n) = tokens.get("output").and_then(|x| x.as_u64()) {
                                tokens_out += n;
                            }
                        }
                    }
                    _ => {}
                }
            }

            detail.tokens_in = tokens_in;
            detail.tokens_out = tokens_out;

            // Parse parts for tool calls.
            let mut part_stmt = guard
                .prepare(
                    "SELECT data, time_created FROM part WHERE session_id = ?1
                     ORDER BY time_created ASC",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let parts = part_stmt
                .query_map([&sid], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })
                .map_err(|e| CoreError::Other(e.to_string()))?;

            for row in parts.flatten() {
                let (data_str, time_created) = row;
                let v: serde_json::Value = match serde_json::from_str(&data_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let part_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if part_type == "tool" {
                    let tool_name = v
                        .get("tool")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    *detail.tools_used.entry(tool_name.clone()).or_default() += 1;

                    let ts = epoch_ms_to_utc(time_created);
                    let state = v.get("state");
                    let success = state
                        .and_then(|s| s.get("status"))
                        .and_then(|s| s.as_str())
                        .map(|s| s == "completed");
                    let args_summary = state.and_then(|s| s.get("input")).map(|inp| {
                        let s = inp.to_string();
                        s.chars().take(300).collect::<String>()
                    });
                    let result_snippet = state
                        .and_then(|s| s.get("output"))
                        .and_then(|o| o.as_str())
                        .map(|s| s.chars().take(300).collect::<String>());

                    detail.tool_calls.push(ToolCall {
                        name: tool_name,
                        timestamp: ts,
                        args_summary,
                        result_snippet,
                        success,
                    });
                }
            }

            Ok(detail)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(detail)
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        let path = self.db_path.clone();
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

    async fn activity_hourly(&self, hours: u32) -> Result<Vec<u64>> {
        let conn = self.conn.clone();
        let hours_usize = hours as usize;
        let buckets = tokio::task::spawn_blocking(move || -> Result<Vec<u64>> {
            let guard = conn.lock().unwrap();
            let now = Utc::now();
            let cutoff_ms = (now - chrono::Duration::hours(hours_usize as i64)).timestamp_millis();
            let mut stmt = guard
                .prepare(
                    "SELECT time_created FROM message
                      WHERE time_created >= ?1
                      ORDER BY time_created ASC",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let rows = stmt
                .query_map([cutoff_ms], |r| r.get::<_, i64>(0))
                .map_err(|e| CoreError::Other(e.to_string()))?;

            let mut buckets = vec![0u64; hours_usize];
            let bucket_start = now - chrono::Duration::hours(hours_usize as i64);
            for ts_ms in rows.flatten() {
                let ts = epoch_ms_to_utc(ts_ms);
                let offset = (ts - bucket_start).num_hours();
                if offset >= 0 && (offset as usize) < hours_usize {
                    buckets[offset as usize] += 1;
                }
            }
            Ok(buckets)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(buckets)
    }

    async fn session_activity_hourly(&self, session_id: &str, hours: u32) -> Result<Vec<u64>> {
        let conn = self.conn.clone();
        let sid = session_id.to_string();
        let hours_usize = hours as usize;
        let buckets = tokio::task::spawn_blocking(move || -> Result<Vec<u64>> {
            let guard = conn.lock().unwrap();
            let now = Utc::now();
            let cutoff_ms = (now - chrono::Duration::hours(hours_usize as i64)).timestamp_millis();
            let mut stmt = guard
                .prepare(
                    "SELECT time_created FROM message
                      WHERE session_id = ?1 AND time_created >= ?2
                      ORDER BY time_created ASC",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let rows = stmt
                .query_map(rusqlite::params![sid, cutoff_ms], |r| r.get::<_, i64>(0))
                .map_err(|e| CoreError::Other(e.to_string()))?;

            let mut buckets = vec![0u64; hours_usize];
            let bucket_start = now - chrono::Duration::hours(hours_usize as i64);
            for ts_ms in rows.flatten() {
                let ts = epoch_ms_to_utc(ts_ms);
                let offset = (ts - bucket_start).num_hours();
                if offset >= 0 && (offset as usize) < hours_usize {
                    buckets[offset as usize] += 1;
                }
            }
            Ok(buckets)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(buckets)
    }

    async fn activity_grid_7x24(&self) -> Result<Vec<Vec<u64>>> {
        let conn = self.conn.clone();
        let grid = tokio::task::spawn_blocking(move || -> Result<Vec<Vec<u64>>> {
            let guard = conn.lock().unwrap();
            let now = Local::now();
            let cutoff = now - chrono::Duration::days(7);
            let cutoff_ms = cutoff.with_timezone(&Utc).timestamp_millis();

            let mut stmt = guard
                .prepare(
                    "SELECT time_created FROM message
                      WHERE time_created >= ?1",
                )
                .map_err(|e| CoreError::Other(e.to_string()))?;
            let rows = stmt
                .query_map([cutoff_ms], |r| r.get::<_, i64>(0))
                .map_err(|e| CoreError::Other(e.to_string()))?;

            let mut grid = vec![vec![0u64; 24]; 7];
            let today = now.date_naive();
            for ts_ms in rows.flatten() {
                let ts = epoch_ms_to_utc(ts_ms).with_timezone(&Local);
                let day = ts.date_naive();
                let days_ago = (today - day).num_days();
                if (0..7).contains(&days_ago) {
                    let hour = ts.hour() as usize;
                    grid[days_ago as usize][hour] += 1;
                }
            }
            Ok(grid)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(grid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db(dir: &std::path::Path) -> PathBuf {
        let db_path = dir.join("opencode.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                directory TEXT,
                title TEXT,
                version TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                time_archived INTEGER
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            );",
        )
        .unwrap();

        let now_ms = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO session (id, project_id, directory, title, time_created, time_updated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "s1",
                "p1",
                "/tmp/project",
                "Test Session",
                now_ms - 60000,
                now_ms
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "m1",
                "s1",
                now_ms - 50000,
                r#"{"role":"user","time":{"created":0}}"#,
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "m2",
                "s1",
                now_ms - 40000,
                r#"{"role":"assistant","modelID":"big-pickle","tokens":{"input":100,"output":50}}"#,
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "pt1",
                "m2",
                "s1",
                now_ms - 40000,
                r#"{"type":"tool","tool":"bash","callID":"c1","state":{"status":"completed","input":{"command":"ls"},"output":"file1 file2"}}"#,
            ],
        )
        .unwrap();

        // Add an archived session that should be skipped.
        conn.execute(
            "INSERT INTO session (id, project_id, directory, title, time_created, time_updated, time_archived)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "s-archived",
                "p1",
                "/tmp/old",
                "Archived",
                now_ms - 100000,
                now_ms - 90000,
                now_ms - 80000,
            ],
        )
        .unwrap();

        db_path
    }

    #[tokio::test]
    async fn list_sessions_skips_archived() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = setup_test_db(dir.path());
        let adapter = OpenCodeAdapter::with_db(db_path).unwrap();
        let sessions = adapter.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s1");
        assert_eq!(sessions[0].agent, AgentKind::OpenCode);
        assert_eq!(sessions[0].model.as_deref(), Some("big-pickle"));
    }

    #[tokio::test]
    async fn get_detail_counts_messages_and_tools() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = setup_test_db(dir.path());
        let adapter = OpenCodeAdapter::with_db(db_path).unwrap();
        let detail = adapter.get_detail("s1").await.unwrap();
        assert_eq!(detail.user_messages, 1);
        assert_eq!(detail.assistant_messages, 1);
        assert_eq!(detail.tokens_in, 100);
        assert_eq!(detail.tokens_out, 50);
        assert_eq!(detail.tools_used.get("bash"), Some(&1));
        assert_eq!(detail.tool_calls.len(), 1);
        assert_eq!(detail.tool_calls[0].name, "bash");
        assert_eq!(detail.tool_calls[0].success, Some(true));
    }

    #[tokio::test]
    async fn get_detail_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = setup_test_db(dir.path());
        let adapter = OpenCodeAdapter::with_db(db_path).unwrap();
        let err = adapter.get_detail("nonexistent").await;
        assert!(err.is_err());
    }

    #[test]
    fn epoch_ms_to_utc_converts_correctly() {
        let ts = epoch_ms_to_utc(1700000000000);
        assert_eq!(ts.timestamp(), 1700000000);
    }
}
