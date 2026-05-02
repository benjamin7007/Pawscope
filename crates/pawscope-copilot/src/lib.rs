pub mod events;
pub mod lock;
pub mod watcher;
pub mod workspace;

use async_trait::async_trait;
use pawscope_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

pub struct CopilotAdapter {
    root: PathBuf,
    state: Arc<RwLock<HashMap<String, events::ParseState>>>,
}

impl CopilotAdapter {
    pub fn new() -> Result<Self> {
        let root = if let Ok(env_dir) = std::env::var("COPILOT_STATE_DIR") {
            PathBuf::from(env_dir)
        } else {
            let home = dirs::home_dir().ok_or_else(|| CoreError::NotFound("home".into()))?;
            home.join(".copilot/session-state")
        };
        Ok(Self::with_root(root))
    }
    pub fn with_root(root: PathBuf) -> Self {
        Self {
            root,
            state: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    fn read_meta(&self, dir: &Path) -> Option<SessionMeta> {
        let ws = workspace::parse(&dir.join("workspace.yaml")).ok()?;
        let live = lock::liveness(dir);
        let status = match live {
            lock::LiveState::Active => SessionStatus::Active,
            _ => SessionStatus::Closed,
        };
        let pid = lock::find_lock_pid(dir);
        let model = Self::extract_model(dir);
        Some(SessionMeta {
            id: ws.id,
            agent: AgentKind::Copilot,
            cwd: PathBuf::from(ws.cwd),
            repo: ws.repository,
            branch: ws.branch,
            summary: ws.summary,
            model,
            status,
            pid,
            started_at: ws.created_at,
            last_event_at: ws.updated_at,
        })
    }

    /// Quickly extract the last model name from events.jsonl without full parsing.
    fn extract_model(dir: &Path) -> Option<String> {
        let events_path = dir.join("events.jsonl");
        let content = std::fs::read_to_string(&events_path).ok()?;
        let mut model = None;
        for line in content.lines() {
            if line.contains("session.model_change") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(m) = v
                        .get("data")
                        .and_then(|d| d.get("newModel"))
                        .and_then(|m| m.as_str())
                    {
                        model = Some(m.to_string());
                    }
                }
            }
        }
        model
    }
}

#[async_trait]
impl AgentAdapter for CopilotAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let mut out = Vec::new();
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(_) => return Ok(out),
        };
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(m) = self.read_meta(&entry.path()) {
                    out.push(m);
                }
            }
        }
        out.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        Ok(out)
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        let path = self.root.join(session_id).join("events.jsonl");
        if !path.exists() {
            return Err(CoreError::NotFound(session_id.to_string()));
        }
        let mut guard = self.state.write().unwrap();
        let st = guard.entry(session_id.to_string()).or_default();
        let _ = events::parse_incremental(&path, st);
        // Strip the heavy conversation log here — it has its own endpoint.
        let mut detail = st.detail.clone();
        detail.conversation = None;
        Ok(detail)
    }

    async fn get_conversation(
        &self,
        session_id: &str,
    ) -> Result<Option<pawscope_core::ConversationLog>> {
        let path = self.root.join(session_id).join("events.jsonl");
        if !path.exists() {
            return Ok(None);
        }
        let mut guard = self.state.write().unwrap();
        let st = guard.entry(session_id.to_string()).or_default();
        let _ = events::parse_incremental(&path, st);
        Ok(Some(st.conversation.clone()))
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        watcher::run(self.root.clone(), self.state.clone(), tx).await
    }

    fn supports_delete(&self) -> bool {
        true
    }

    async fn delete_session(&self, session_id: &str) -> Result<String> {
        let src = self.root.join(session_id);
        if !src.is_dir() {
            return Err(CoreError::NotFound(session_id.to_string()));
        }
        // Path-traversal guard: ensure src is under self.root
        let canon_root = std::fs::canonicalize(&self.root)
            .map_err(|e| CoreError::Other(format!("canonicalize root: {e}")))?;
        let canon_src = std::fs::canonicalize(&src)
            .map_err(|e| CoreError::Other(format!("canonicalize src: {e}")))?;
        if !canon_src.starts_with(&canon_root) {
            return Err(CoreError::Other("path traversal denied".into()));
        }
        let trash = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".pawscope/trash/copilot")
            .join(session_id);
        if let Some(parent) = trash.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        // Try rename (same filesystem = instant); fall back to copy+delete
        if tokio::fs::rename(&src, &trash).await.is_err() {
            copy_dir_recursive(&src, &trash).await?;
            tokio::fs::remove_dir_all(&src).await?;
        }
        // Purge from state cache
        self.state.write().unwrap().remove(session_id);
        Ok(trash.to_string_lossy().into_owned())
    }

    async fn activity_hourly(&self, hours: u32) -> Result<Vec<u64>> {
        use chrono::{DateTime, Utc};
        let hours = hours.max(1) as usize;
        let now = Utc::now();
        let window_start = now - chrono::Duration::hours(hours as i64);
        let mut buckets = vec![0u64; hours];

        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(_) => return Ok(buckets),
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path().join("events.jsonl");
            let Ok(file) = std::fs::File::open(&path) else {
                continue;
            };
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(file);
            for line in reader.lines().map_while(std::result::Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) else {
                    continue;
                };
                let Ok(dt) = DateTime::parse_from_rfc3339(ts) else {
                    continue;
                };
                let dt = dt.with_timezone(&Utc);
                if dt < window_start || dt > now {
                    continue;
                }
                let elapsed = (now - dt).num_hours() as usize;
                if elapsed < hours {
                    let idx = hours - 1 - elapsed;
                    buckets[idx] += 1;
                }
            }
        }
        Ok(buckets)
    }

    async fn session_activity_hourly(&self, session_id: &str, hours: u32) -> Result<Vec<u64>> {
        use chrono::{DateTime, Utc};
        use std::io::{BufRead, BufReader};
        let hours = hours.max(1) as usize;
        let now = Utc::now();
        let window_start = now - chrono::Duration::hours(hours as i64);
        let mut buckets = vec![0u64; hours];
        let path = self.root.join(session_id).join("events.jsonl");
        let Ok(file) = std::fs::File::open(&path) else {
            return Ok(buckets);
        };
        for line in BufReader::new(file)
            .lines()
            .map_while(std::result::Result::ok)
        {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) else {
                continue;
            };
            let Ok(dt) = DateTime::parse_from_rfc3339(ts) else {
                continue;
            };
            let dt = dt.with_timezone(&Utc);
            if dt < window_start || dt > now {
                continue;
            }
            let elapsed = (now - dt).num_hours() as usize;
            if elapsed < hours {
                buckets[hours - 1 - elapsed] += 1;
            }
        }
        Ok(buckets)
    }

    async fn activity_grid_7x24(&self) -> Result<Vec<Vec<u64>>> {
        use chrono::{DateTime, Local, Timelike};
        let mut grid = vec![vec![0u64; 24]; 7];
        let today_local = Local::now().date_naive();
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(_) => return Ok(grid),
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path().join("events.jsonl");
            let Ok(file) = std::fs::File::open(&path) else {
                continue;
            };
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(file);
            for line in reader.lines().map_while(std::result::Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) else {
                    continue;
                };
                let Ok(dt_utc) = DateTime::parse_from_rfc3339(ts) else {
                    continue;
                };
                let local = dt_utc.with_timezone(&Local);
                let days_ago = (today_local - local.date_naive()).num_days();
                if !(0..7).contains(&days_ago) {
                    continue;
                }
                let hour = local.hour() as usize;
                grid[days_ago as usize][hour] += 1;
            }
        }
        Ok(grid)
    }
}

async fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut rd = tokio::fs::read_dir(src).await?;
    while let Some(entry) = rd.next_entry().await? {
        let ty = entry.file_type().await?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            Box::pin(copy_dir_recursive(&entry.path(), &dest)).await?;
        } else {
            tokio::fs::copy(entry.path(), &dest).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn list_sessions_reads_fixtures() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/copilot");
        let a = CopilotAdapter::with_root(root);
        let sess = a.list_sessions().await.unwrap();
        assert!(
            sess.iter()
                .any(|s| s.id == "4dac1bf8-ee21-4659-bc60-00aad57573fb")
        );
    }
    #[tokio::test]
    async fn get_detail_works() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/copilot");
        let a = CopilotAdapter::with_root(root);
        let d = a
            .get_detail("4dac1bf8-ee21-4659-bc60-00aad57573fb")
            .await
            .unwrap();
        assert_eq!(d.user_messages, 1);
    }
}
