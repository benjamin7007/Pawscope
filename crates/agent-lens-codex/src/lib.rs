use agent_lens_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus,
};
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
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
        // Codex rollouts live outside the SQLite DB; until rollout parsing is
        // wired up, return a default detail so the UI still renders metadata.
        // We surface tokens_used and first_user_message as a prompt summary.
        let conn = self.conn.clone();
        let id = session_id.to_string();
        let detail = tokio::task::spawn_blocking(move || -> Result<SessionDetail> {
            let guard = conn.lock().unwrap();
            let mut stmt = guard
                .prepare(
                    "SELECT first_user_message, tokens_used, created_at
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
            let _tokens: i64 = row.get(1).unwrap_or(0);
            let created: i64 = row.get(2).unwrap_or(0);
            let mut detail = SessionDetail::default();
            if !fum.trim().is_empty() {
                let snippet: String = fum.chars().take(120).collect();
                detail.user_messages = 1;
                detail.prompts.push(agent_lens_core::PromptSummary {
                    id: "first".into(),
                    timestamp: Utc.timestamp_opt(created, 0).single(),
                    snippet,
                    text: fum,
                });
            }
            Ok(detail)
        })
        .await
        .map_err(|e| CoreError::Other(e.to_string()))??;
        Ok(detail)
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
}
