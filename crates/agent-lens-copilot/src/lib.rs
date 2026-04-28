pub mod events;
pub mod lock;
pub mod watcher;
pub mod workspace;

use agent_lens_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus,
};
use async_trait::async_trait;
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
        Some(SessionMeta {
            id: ws.id,
            agent: AgentKind::Copilot,
            cwd: PathBuf::from(ws.cwd),
            repo: ws.repository,
            branch: ws.branch,
            summary: ws.summary,
            model: None,
            status,
            pid,
            started_at: ws.created_at,
            last_event_at: ws.updated_at,
        })
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
        let mut guard = self.state.write().unwrap();
        let st = guard.entry(session_id.to_string()).or_default();
        let _ = events::parse_incremental(&path, st);
        Ok(st.detail.clone())
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        watcher::run(self.root.clone(), self.state.clone(), tx).await
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
