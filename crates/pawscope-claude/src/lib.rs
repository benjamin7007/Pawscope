//! Claude Code adapter — reads `~/.claude/projects/<encoded-cwd>/<session>.jsonl`.
//!
//! Schema (one JSON object per line):
//! - `type=user`     → has `message.content` (string or array)
//! - `type=assistant`→ has `message.model`, `message.content` (array with `text` and `tool_use`)
//! - `type=system|progress|queue-operation|attachment|last-prompt` → ignored for stats
//!
//! Active detection: Claude Code writes no PID lock; we mark a session "active" when
//! its file mtime is within the last 5 minutes.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use pawscope_core::{
    AgentAdapter, AgentKind, AssistantTurn, ConversationLog, CoreError, Interaction, Result,
    SessionDetail, SessionEvent, SessionMeta, SessionStatus, ToolCall, TurnItem, TurnToolCall,
    UserMessageKind,
};
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
    // v0.7: structured conversation flow.
    conversation: ConversationLog,
    // Index into conversation.interactions; None until first user.message
    // (or first sidechain-skipped assistant turn — we lazy-create a synthetic
    // interaction in that rare case).
    current_interaction: Option<usize>,
    // Index into the current interaction's turns.
    current_turn: Option<usize>,
    // tool_use_id (Claude's own, e.g. "toolu_…") → (interaction_idx, turn_idx, item_idx).
    // Used to fill the matching Tool item's result/success when the next
    // user.message arrives carrying a tool_result block.
    tool_call_to_pos: HashMap<String, (usize, usize, usize)>,
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
                    let (turns, tool_calls, tools, started_at, ended_at) = count_subagent(&p);
                    let meta_path = p.with_extension("meta.json");
                    let (agent_type, description) = std::fs::read_to_string(&meta_path)
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .map(|v| {
                            (
                                v.get("agentType")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string),
                                v.get("description")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string),
                            )
                        })
                        .unwrap_or((None, None));
                    let active = std::fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .map(|d| d.as_secs() < ACTIVE_WINDOW_SECS as u64)
                        .unwrap_or(false);
                    st.detail.subagents.push(pawscope_core::SubagentSummary {
                        id: stem,
                        turns,
                        tool_calls,
                        tools,
                        agent_type,
                        description,
                        started_at,
                        ended_at,
                        active,
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

type SubagentStats = (
    u32,
    u32,
    std::collections::HashMap<String, u32>,
    Option<chrono::DateTime<chrono::Utc>>,
    Option<chrono::DateTime<chrono::Utc>>,
);

fn count_subagent(path: &Path) -> SubagentStats {
    use std::io::{BufRead, BufReader};
    let Ok(file) = std::fs::File::open(path) else {
        return (0, 0, std::collections::HashMap::new(), None, None);
    };
    let mut turns = 0u32;
    let mut tool_calls = 0u32;
    let mut tools: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut started_at: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut ended_at: Option<chrono::DateTime<chrono::Utc>> = None;
    for line in BufReader::new(file)
        .lines()
        .map_while(std::result::Result::ok)
    {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(ts_str) = v.get("timestamp").and_then(|t| t.as_str()) {
            if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                let ts_utc = ts.with_timezone(&chrono::Utc);
                if started_at.is_none() {
                    started_at = Some(ts_utc);
                }
                ended_at = Some(ts_utc);
            }
        }
        if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
            turns += 1;
            if let Some(arr) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for it in arr {
                    if it.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        tool_calls += 1;
                        if let Some(name) = it.get("name").and_then(|n| n.as_str()) {
                            *tools.entry(name.to_string()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
    }
    (turns, tool_calls, tools, started_at, ended_at)
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
        st.conversation = ConversationLog::default();
        st.current_interaction = None;
        st.current_turn = None;
        st.tool_call_to_pos.clear();
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
        // Sidechain events belong to a Task subagent and would otherwise
        // pollute the main interaction list with synthetic user messages.
        // For v0.7 we count their tool calls in stats but skip the
        // structured conversation log. Subagent nesting lands in v0.7.x.
        let is_sidechain = v
            .get("isSidechain")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);
        match v.get("type").and_then(|t| t.as_str()) {
            Some("system") if !is_sidechain => {
                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                    if let Some(at) = st.last_event_at {
                        st.conversation
                            .system_prompts
                            .push(pawscope_core::SystemPromptMarker {
                                at,
                                content: content.to_string(),
                                model: None,
                            });
                        st.conversation.version += 1;
                    }
                }
            }
            Some("user") => {
                st.detail.user_messages += 1;
                let prompt_id = v
                    .get("promptId")
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());
                let full_text: String = v.get("message").map(extract_text).unwrap_or_default();
                let snippet: String = full_text.chars().take(120).collect();
                if st.summary.is_none() && !snippet.is_empty() {
                    st.summary = Some(snippet.chars().take(80).collect());
                }
                if let Some(id) = prompt_id {
                    if !st.detail.prompts.iter().any(|p| p.id == id) {
                        st.detail.prompts.push(pawscope_core::PromptSummary {
                            id,
                            timestamp: st.last_event_at,
                            snippet,
                            text: full_text.clone(),
                        });
                    }
                }
                if !is_sidechain {
                    apply_user_event(st, &v, &full_text);
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
                    if let Some(usage) = msg.get("usage") {
                        let ti =
                            usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let to_ = usage
                            .get("output_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        st.detail.tokens_in += ti;
                        st.detail.tokens_out += to_;
                    }
                    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                        for it in arr {
                            if it.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                if let Some(name) = it.get("name").and_then(|n| n.as_str()) {
                                    *st.detail.tools_used.entry(name.to_string()).or_default() +=
                                        1;
                                    if let Some(ts) = st.last_event_at {
                                        let args_summary = it.get("input").map(|v| {
                                            let s = match v {
                                                serde_json::Value::String(s) => s.clone(),
                                                other => {
                                                    serde_json::to_string(other).unwrap_or_default()
                                                }
                                            };
                                            if s.chars().count() <= 300 {
                                                s
                                            } else {
                                                let mut t: String = s.chars().take(300).collect();
                                                t.push('…');
                                                t
                                            }
                                        });
                                        st.detail.tool_calls.push(ToolCall {
                                            name: name.to_string(),
                                            timestamp: ts,
                                            args_summary,
                                            ..Default::default()
                                        });
                                    }
                                }
                            }
                        }
                    }
                    if !is_sidechain {
                        apply_assistant_event(st, msg);
                    }
                }
            }
            _ => {}
        }
    }
}

// --- v0.7 conversation builders ---

fn classify_user_kind(text: &str) -> UserMessageKind {
    let t = text.trim_start();
    let injected_prefixes = [
        "<command-name>",
        "<command-message>",
        "<system-reminder>",
        "<bash-input>",
        "<bash-stdout>",
        "<local-command-stdout>",
    ];
    for p in injected_prefixes {
        if t.starts_with(p) {
            return UserMessageKind::InjectedContext;
        }
    }
    UserMessageKind::Human
}

fn apply_user_event(st: &mut ParseState, v: &serde_json::Value, full_text: &str) {
    let at = match st.last_event_at {
        Some(t) => t,
        None => return,
    };
    let msg = v.get("message");
    let content = msg.and_then(|m| m.get("content"));

    // Distinguish "user-with-tool-results" (which fills earlier Tool items) from
    // "real user message" (which starts a new Interaction).
    let mut filled_any_tool_result = false;
    if let Some(arr) = content.and_then(|c| c.as_array()) {
        for it in arr {
            if it.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                let id = it
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let is_error = it
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let snippet: Option<String> = it.get("content").map(|c| {
                    let s = match c {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Array(arr) => arr
                            .iter()
                            .filter_map(|i| i.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join(""),
                        other => serde_json::to_string(other).unwrap_or_default(),
                    };
                    if s.chars().count() <= 600 {
                        s
                    } else {
                        let mut t: String = s.chars().take(600).collect();
                        t.push('…');
                        t
                    }
                });
                if let Some(&(ii, ti, ix)) = st.tool_call_to_pos.get(id) {
                    if let Some(turn) = st
                        .conversation
                        .interactions
                        .get_mut(ii)
                        .and_then(|i| i.turns.get_mut(ti))
                    {
                        if let Some(TurnItem::Tool(tc)) = turn.items.get_mut(ix) {
                            tc.result_snippet = snippet;
                            tc.success = Some(!is_error);
                            filled_any_tool_result = true;
                            st.conversation.version += 1;
                        }
                    }
                }
            }
        }
    }
    // If the user message was *only* tool results, don't start a new interaction.
    let only_tool_results = filled_any_tool_result
        && content
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .all(|it| it.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            })
            .unwrap_or(false);
    if only_tool_results {
        return;
    }

    // Otherwise: a fresh user-driven interaction.
    let kind = classify_user_kind(full_text);
    let id = v
        .get("uuid")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("u-{}", st.conversation.interactions.len()));
    st.conversation.interactions.push(Interaction {
        interaction_id: id,
        started_at: at,
        user_message_raw: if full_text.is_empty() {
            None
        } else {
            Some(full_text.to_string())
        },
        user_message_transformed: None,
        kind,
        turns: Vec::new(),
    });
    st.current_interaction = Some(st.conversation.interactions.len() - 1);
    st.current_turn = None;
    st.conversation.version += 1;
}

fn apply_assistant_event(st: &mut ParseState, msg: &serde_json::Value) {
    let at = match st.last_event_at {
        Some(t) => t,
        None => return,
    };
    // Lazy synthetic interaction if the file starts with assistant events.
    let ii = match st.current_interaction {
        Some(i) => i,
        None => {
            st.conversation.interactions.push(Interaction {
                interaction_id: format!("synthetic-{}", st.conversation.interactions.len()),
                started_at: at,
                user_message_raw: None,
                user_message_transformed: None,
                kind: UserMessageKind::InjectedContext,
                turns: Vec::new(),
            });
            let i = st.conversation.interactions.len() - 1;
            st.current_interaction = Some(i);
            i
        }
    };
    let turn_id = msg
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("t-{}", st.conversation.version));
    let mut new_turn = AssistantTurn {
        turn_id,
        started_at: at,
        completed_at: Some(at), // Claude assistant events are atomic; one event = full turn.
        items: Vec::new(),
        usage: None,
    };
    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
        for it in arr {
            match it.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(text) = it.get("text").and_then(|t| t.as_str()) {
                        if !text.is_empty() {
                            new_turn.items.push(TurnItem::AssistantMessage {
                                at,
                                content: text.to_string(),
                            });
                        }
                    }
                }
                Some("tool_use") => {
                    let name = it
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let id = it
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args_summary = it.get("input").map(|v| {
                        let s = match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => serde_json::to_string(other).unwrap_or_default(),
                        };
                        if s.chars().count() <= 600 {
                            s
                        } else {
                            let mut t: String = s.chars().take(600).collect();
                            t.push('…');
                            t
                        }
                    });
                    new_turn.items.push(TurnItem::Tool(TurnToolCall {
                        call_id: id.clone(),
                        name,
                        at,
                        args_summary,
                        result_snippet: None,
                        success: None,
                    }));
                    // Remember position so the next tool_result can fill it in.
                    let item_idx = new_turn.items.len() - 1;
                    let ti = st.conversation.interactions[ii].turns.len(); // not pushed yet
                    if !id.is_empty() {
                        st.tool_call_to_pos.insert(id, (ii, ti, item_idx));
                    }
                }
                // "thinking" intentionally skipped in v0.7.
                _ => {}
            }
        }
    }
    st.conversation.interactions[ii].turns.push(new_turn);
    st.current_turn = Some(st.conversation.interactions[ii].turns.len() - 1);
    st.conversation.version += 1;
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
                    let mut detail = st.detail;
                    detail.conversation = None; // heavy; use /conversation endpoint
                    return Ok(detail);
                }
            }
        }
        Err(CoreError::NotFound(session_id.into()))
    }

    async fn get_conversation(&self, session_id: &str) -> Result<Option<ConversationLog>> {
        for (path, id) in self.iter_session_files() {
            if id == session_id {
                if let Some(st) = self.parse_full(&path, &id) {
                    return Ok(Some(st.conversation));
                }
            }
        }
        Ok(None)
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        // Simple poll-based watcher: every 2s scan for size changes.
        let mut last_sizes: HashMap<PathBuf, u64> = HashMap::new();
        let mut last_conv_version: HashMap<String, u64> = HashMap::new();
        loop {
            let mut changed = false;
            let mut detail_updates: Vec<(String, SessionDetail, u64)> = Vec::new();
            for (path, id) in self.iter_session_files() {
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let prev = last_sizes.insert(path.clone(), size);
                if prev != Some(size) {
                    changed = true;
                    if let Some(st) = self.parse_full(&path, &id) {
                        let conv_v = st.conversation.version;
                        let mut detail = st.detail;
                        detail.conversation = None;
                        detail_updates.push((id, detail, conv_v));
                    }
                }
            }
            if changed {
                let _ = tx.send(SessionEvent::SessionListChanged).await;
                for (session_id, detail, conv_v) in detail_updates {
                    let prev_v = last_conv_version.get(&session_id).copied().unwrap_or(0);
                    let _ = tx
                        .send(SessionEvent::DetailUpdated {
                            session_id: session_id.clone(),
                            detail,
                        })
                        .await;
                    if conv_v != prev_v {
                        last_conv_version.insert(session_id.clone(), conv_v);
                        let _ = tx
                            .send(SessionEvent::ConversationUpdated {
                                session_id,
                                version: conv_v,
                            })
                            .await;
                    }
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

    async fn session_activity_hourly(&self, session_id: &str, hours: u32) -> Result<Vec<u64>> {
        let hours = hours.max(1) as usize;
        let now = Utc::now();
        let window_start = now - chrono::Duration::hours(hours as i64);
        let mut buckets = vec![0u64; hours];
        for (path, id) in self.iter_session_files() {
            if id != session_id {
                continue;
            }
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

    #[tokio::test]
    async fn sums_usage_across_assistant_messages() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("-Users-foo-proj").join("tok-1.jsonl");
        write(
            &f,
            r#"{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-04-29T10:00:00Z","cwd":"/Users/foo/proj"}
{"type":"assistant","timestamp":"2026-04-29T10:00:01Z","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":100,"output_tokens":50},"content":[{"type":"text","text":"ok"}]}}
{"type":"assistant","timestamp":"2026-04-29T10:00:02Z","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":150,"output_tokens":80},"content":[{"type":"text","text":"more"}]}}
"#,
        );
        let a = ClaudeAdapter::with_root(tmp.path().to_path_buf());
        let d = a.get_detail("tok-1").await.unwrap();
        assert_eq!(d.tokens_in, 250);
        assert_eq!(d.tokens_out, 130);
    }
}
