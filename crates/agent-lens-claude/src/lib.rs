//! Claude Code adapter — reads `~/.claude/projects/<encoded-cwd>/<session>.jsonl`.
//!
//! Schema (one JSON object per line):
//! - `type=user`     → has `message.content` (string or array)
//! - `type=assistant`→ has `message.model`, `message.content` (array with `text` and `tool_use`)
//! - `type=system|progress|queue-operation|attachment|last-prompt` → ignored for stats
//!
//! Active detection: Claude Code writes no PID lock; we mark a session "active" when
//! its file mtime is within the last 5 minutes.

use agent_lens_core::{
    AgentAdapter, AgentKind, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
    SessionStatus,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;

const ACTIVE_WINDOW_SECS: i64 = 300;

#[derive(Default, Clone)]
struct ParseState {
    offset: u64,
    detail: SessionDetail,
    model: Option<String>,
    cwd: Option<String>,
    branch: Option<String>,
    started_at: Option<DateTime<Utc>>,
    last_event_at: Option<DateTime<Utc>>,
    summary: Option<String>,
}

pub struct ClaudeAdapter {
    root: PathBuf,
    state: Arc<RwLock<HashMap<String, ParseState>>>,
}

impl ClaudeAdapter {
    pub fn new() -> Result<Self> {
        let root = if let Ok(env_dir) = std::env::var("CLAUDE_STATE_DIR") {
            PathBuf::from(env_dir)
        } else {
            let home = dirs::home_dir().ok_or_else(|| CoreError::NotFound("home".into()))?;
            home.join(".claude/projects")
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

    fn iter_session_files(&self) -> Vec<(PathBuf, String)> {
        let mut out = Vec::new();
        let Ok(projects) = std::fs::read_dir(&self.root) else {
            return out;
        };
        for proj in projects.flatten() {
            if !proj.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(proj.path()) else {
                continue;
            };
            for f in files.flatten() {
                let p = f.path();
                if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        out.push((p.clone(), stem.to_string()));
                    }
                }
            }
        }
        out
    }

    fn parse_full(&self, path: &Path, id: &str) -> Option<ParseState> {
        let mut st = self
            .state
            .write()
            .unwrap()
            .get(id)
            .cloned()
            .unwrap_or_default();
        parse_incremental(path, &mut st);
        let sub_dir = path
            .parent()
            .map(|p| p.join(id).join("subagents"))
            .unwrap_or_default();
        if sub_dir.is_dir() {
            st.detail.subagents.clear();
            if let Ok(entries) = std::fs::read_dir(&sub_dir) {
                for ent in entries.flatten() {
                    let p = ent.path();
                    if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                        continue;
                    }
                    let stem = p
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let (turns, tool_calls) = count_subagent(&p);
                    st.detail.subagents.push(agent_lens_core::SubagentSummary {
                        id: stem,
                        turns,
                        tool_calls,
                    });
                }
            }
            st.detail.subagents.sort_by(|a, b| b.turns.cmp(&a.turns));
        }
        self.state
            .write()
            .unwrap()
            .insert(id.to_string(), st.clone());
        Some(st)
    }
}

fn count_subagent(path: &Path) -> (u32, u32) {
    use std::io::{BufRead, BufReader};
    let Ok(file) = std::fs::File::open(path) else {
        return (0, 0);
    };
    let mut turns = 0u32;
    let mut tools = 0u32;
    for line in BufReader::new(file)
        .lines()
        .map_while(std::result::Result::ok)
    {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
            turns += 1;
            if let Some(arr) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for it in arr {
                    if it.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        tools += 1;
                    }
                }
            }
        }
    }
    (turns, tools)
}

fn parse_incremental(path: &Path, st: &mut ParseState) {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < st.offset {
        st.offset = 0;
        st.detail = SessionDetail::default();
        st.model = None;
        st.started_at = None;
        st.last_event_at = None;
        st.summary = None;
    }
    if len == st.offset {
        return;
    }
    if f.seek(SeekFrom::Start(st.offset)).is_err() {
        return;
    }
    let mut reader = BufReader::new(f);
    let mut line = String::new();
    loop {
        line.clear();
        let n = match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        if !line.ends_with('\n') {
            break;
        }
        st.offset += n as u64;
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim_end()) else {
            continue;
        };
        if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
            if let Ok(dt) = DateTime::parse_from_rfc3339(ts) {
                let utc = dt.with_timezone(&Utc);
                st.started_at.get_or_insert(utc);
                st.last_event_at = Some(utc);
            }
        }
        if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
            st.cwd.get_or_insert_with(|| c.to_string());
        }
        if let Some(b) = v.get("gitBranch").and_then(|b| b.as_str()) {
            st.branch.get_or_insert_with(|| b.to_string());
        }
        match v.get("type").and_then(|t| t.as_str()) {
            Some("user") => {
                st.detail.user_messages += 1;
                let prompt_id = v
                    .get("promptId")
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());
                let snippet: String = v
                    .get("message")
                    .map(extract_text)
                    .unwrap_or_default()
                    .chars()
                    .take(120)
                    .collect();
                if st.summary.is_none() && !snippet.is_empty() {
                    st.summary = Some(snippet.chars().take(80).collect());
                }
                if let Some(id) = prompt_id {
                    if !st.detail.prompts.iter().any(|p| p.id == id) {
                        st.detail.prompts.push(agent_lens_core::PromptSummary {
                            id,
                            timestamp: st.last_event_at,
                            snippet,
                        });
                    }
                }
            }
            Some("assistant") => {
                st.detail.assistant_messages += 1;
                st.detail.turns += 1;
                if let Some(msg) = v.get("message") {
                    if let Some(model) = msg.get("model").and_then(|m| m.as_str()) {
                        if model != "<synthetic>" {
                            st.model = Some(model.to_string());
                        }
                    }
                    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                        for it in arr {
                            if it.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                if let Some(name) = it.get("name").and_then(|n| n.as_str()) {
                                    *st.detail.tools_used.entry(name.to_string()).or_default() += 1;
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_text(message: &serde_json::Value) -> String {
    let c = message.get("content");
    match c {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|it| {
                it.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

#[async_trait]
impl AgentAdapter for ClaudeAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let now = Utc::now();
        let mut out = Vec::new();
        for (path, id) in self.iter_session_files() {
            let Some(st) = self.parse_full(&path, &id) else {
                continue;
            };
            let last = st.last_event_at.unwrap_or_else(Utc::now);
            let started = st.started_at.unwrap_or(last);
            let active = (now - last).num_seconds() < ACTIVE_WINDOW_SECS;
            out.push(SessionMeta {
                id: id.clone(),
                agent: AgentKind::Claude,
                cwd: PathBuf::from(st.cwd.unwrap_or_default()),
                repo: None,
                branch: st.branch,
                summary: st.summary.unwrap_or_default(),
                model: st.model,
                status: if active {
                    SessionStatus::Active
                } else {
                    SessionStatus::Closed
                },
                pid: None,
                started_at: started,
                last_event_at: last,
            });
        }
        out.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        Ok(out)
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        for (path, id) in self.iter_session_files() {
            if id == session_id {
                if let Some(st) = self.parse_full(&path, &id) {
                    return Ok(st.detail);
                }
            }
        }
        Err(CoreError::NotFound(session_id.into()))
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        // Simple poll-based watcher: every 2s scan for size changes.
        let mut last_sizes: HashMap<PathBuf, u64> = HashMap::new();
        loop {
            let mut changed = false;
            let mut detail_updates = Vec::new();
            for (path, id) in self.iter_session_files() {
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let prev = last_sizes.insert(path.clone(), size);
                if prev != Some(size) {
                    changed = true;
                    if let Some(st) = self.parse_full(&path, &id) {
                        detail_updates.push((id, st.detail));
                    }
                }
            }
            if changed {
                let _ = tx.send(SessionEvent::SessionListChanged).await;
                for (session_id, detail) in detail_updates {
                    let _ = tx
                        .send(SessionEvent::DetailUpdated { session_id, detail })
                        .await;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    async fn activity_hourly(&self, hours: u32) -> Result<Vec<u64>> {
        let hours = hours.max(1) as usize;
        let now = Utc::now();
        let window_start = now - chrono::Duration::hours(hours as i64);
        let mut buckets = vec![0u64; hours];
        for (path, _id) in self.iter_session_files() {
            scan_timestamps(&path, |dt| {
                if dt < window_start || dt > now {
                    return;
                }
                let elapsed = (now - dt).num_hours() as usize;
                if elapsed < hours {
                    buckets[hours - 1 - elapsed] += 1;
                }
            });
        }
        Ok(buckets)
    }

    async fn activity_grid_7x24(&self) -> Result<Vec<Vec<u64>>> {
        use chrono::{Local, Timelike};
        let mut grid = vec![vec![0u64; 24]; 7];
        let today = Local::now().date_naive();
        for (path, _id) in self.iter_session_files() {
            scan_timestamps(&path, |dt_utc| {
                let local = dt_utc.with_timezone(&Local);
                let days_ago = (today - local.date_naive()).num_days();
                if (0..7).contains(&days_ago) {
                    grid[days_ago as usize][local.hour() as usize] += 1;
                }
            });
        }
        Ok(grid)
    }
}

fn scan_timestamps<F: FnMut(DateTime<Utc>)>(path: &Path, mut f: F) {
    use std::io::{BufRead, BufReader};
    let Ok(file) = std::fs::File::open(path) else {
        return;
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
        f(dt.with_timezone(&Utc));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    #[tokio::test]
    async fn parses_sessions_and_tools() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("-Users-foo-proj").join("abc-123.jsonl");
        write(
            &f,
            r#"{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-04-29T10:00:00Z","cwd":"/Users/foo/proj","gitBranch":"main"}
{"type":"assistant","timestamp":"2026-04-29T10:00:01Z","message":{"model":"claude-sonnet-4-6","content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"Bash","id":"x"}]}}
{"type":"assistant","timestamp":"2026-04-29T10:00:02Z","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","name":"Bash","id":"y"}]}}
"#,
        );
        let a = ClaudeAdapter::with_root(tmp.path().to_path_buf());
        let sessions = a.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "abc-123");
        assert_eq!(sessions[0].agent, AgentKind::Claude);
        assert_eq!(sessions[0].branch.as_deref(), Some("main"));
        let d = a.get_detail("abc-123").await.unwrap();
        assert_eq!(d.user_messages, 1);
        assert_eq!(d.assistant_messages, 2);
        assert_eq!(d.tools_used.get("Bash"), Some(&2));
    }

    #[tokio::test]
    async fn empty_dir_returns_no_sessions() {
        let tmp = TempDir::new().unwrap();
        let a = ClaudeAdapter::with_root(tmp.path().to_path_buf());
        assert!(a.list_sessions().await.unwrap().is_empty());
    }
}
