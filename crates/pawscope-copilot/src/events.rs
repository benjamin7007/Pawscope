use pawscope_core::types::{
    AssistantTurn, CompactionMarker, ConversationLog, Interaction, SessionDetail,
    SubagentScope, SystemPromptMarker, ToolCall, TurnItem, TurnToolCall, UserMessageKind,
};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Event<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    timestamp: Option<String>,
}

/// Reference to a "scope" — somewhere assistant messages and tool calls
/// can live. Either the active assistant turn directly, or a nested
/// subagent scope inside that turn.
#[derive(Debug, Clone)]
enum ScopeRef {
    Turn { interaction: usize, turn: usize },
    Subagent {
        interaction: usize,
        turn: usize,
        /// Path of subagent indices from the turn down to the active one.
        path: Vec<usize>,
    },
}

#[derive(Debug, Default, Clone)]
pub struct ParseState {
    pub offset: u64,
    pub detail: SessionDetail,
    pub model: Option<String>,
    /// Maps toolCallId → index into `detail.tool_calls`, for matching
    /// tool.execution_complete events back to the right invocation in the
    /// flat tool_calls list (kept for backwards compat).
    #[doc(hidden)]
    pub tool_call_index: std::collections::HashMap<String, usize>,
    /// Conversation log being built up incrementally. Lifted to the top
    /// level here so subsequent calls can keep mutating it.
    pub conversation: ConversationLog,
    /// Active assistant turn (and possibly nested subagents) into which new
    /// items should be appended.
    current_scope: Option<ScopeRef>,
    /// Index into `conversation.interactions` for the active interaction.
    current_interaction: Option<usize>,
    /// Index into `conversation.compaction_markers` for an open marker.
    current_compaction: Option<usize>,
    /// Maps toolCallId → ScopeRef + index of the TurnItem::Tool inside it,
    /// so completion events can update the right tool record.
    #[doc(hidden)]
    tool_scope_map: std::collections::HashMap<String, (ScopeRef, usize)>,
}

pub fn parse_incremental(path: &Path, state: &mut ParseState) -> anyhow::Result<()> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    if len < state.offset {
        state.offset = 0;
        state.detail = SessionDetail::default();
        state.model = None;
        state.tool_call_index.clear();
        state.conversation = ConversationLog::default();
        state.current_scope = None;
        state.current_interaction = None;
        state.current_compaction = None;
        state.tool_scope_map.clear();
    }
    if len == state.offset {
        return Ok(());
    }
    f.seek(SeekFrom::Start(state.offset))?;
    let mut reader = BufReader::new(f);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            break;
        }
        if !line.ends_with('\n') {
            break;
        }
        state.offset += n as u64;
        let trimmed = line.trim_end();
        let ev: Event = match serde_json::from_str(trimmed) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ts = parse_ts(ev.timestamp.as_deref());
        match ev.kind {
            "system.message" => {
                if let (Some(at), Some(content)) = (
                    ts,
                    ev.data.get("content").and_then(|v| v.as_str()),
                ) {
                    state.conversation.system_prompts.push(SystemPromptMarker {
                        at,
                        content: content.to_string(),
                        model: state.model.clone(),
                    });
                    state.conversation.version += 1;
                }
            }
            "session.compaction_start" => {
                if let Some(at) = ts {
                    state.conversation.compaction_markers.push(CompactionMarker {
                        started_at: at,
                        completed_at: None,
                    });
                    state.current_compaction = Some(state.conversation.compaction_markers.len() - 1);
                    // Compaction closes the current interaction context.
                    state.current_interaction = None;
                    state.current_scope = None;
                    state.conversation.version += 1;
                }
            }
            "session.compaction_complete" => {
                if let Some(idx) = state.current_compaction.take() {
                    if let Some(m) = state.conversation.compaction_markers.get_mut(idx) {
                        m.completed_at = ts;
                        state.conversation.version += 1;
                    }
                }
            }
            "user.message" => {
                state.detail.user_messages += 1;
                let content = ev.data.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let transformed = ev
                    .data
                    .get("transformedContent")
                    .and_then(|v| v.as_str());
                let interaction_id = ev
                    .data
                    .get("interactionId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("p{}", state.detail.prompts.len()));

                // Maintain the legacy prompts list (used elsewhere).
                if !state.detail.prompts.iter().any(|p| p.id == interaction_id) {
                    let snippet: String = content.chars().take(120).collect();
                    state.detail.prompts.push(pawscope_core::PromptSummary {
                        id: interaction_id.clone(),
                        timestamp: ts,
                        snippet,
                        text: content.to_string(),
                    });
                }

                if let Some(at) = ts {
                    let kind = classify_user_message(content);
                    state.conversation.interactions.push(Interaction {
                        interaction_id: interaction_id.clone(),
                        started_at: at,
                        kind,
                        user_message_raw: if content.is_empty() {
                            None
                        } else {
                            Some(content.to_string())
                        },
                        user_message_transformed: transformed.map(|s| s.to_string()),
                        turns: Vec::new(),
                    });
                    state.current_interaction = Some(state.conversation.interactions.len() - 1);
                    state.current_scope = None;
                    state.conversation.version += 1;
                }
            }
            "assistant.message" => {
                state.detail.assistant_messages += 1;
                if let (Some(at), Some(content)) = (
                    ts,
                    ev.data.get("content").and_then(|v| v.as_str()),
                ) {
                    let scope = state.ensure_active_turn(at);
                    if let Some(items) = state.scope_items_mut(&scope) {
                        items.push(TurnItem::AssistantMessage {
                            at,
                            content: content.to_string(),
                        });
                        state.conversation.version += 1;
                    }
                }
            }
            "assistant.turn_start" => {
                if let Some(at) = ts {
                    let turn_id = ev
                        .data
                        .get("turnId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    state.start_turn(at, turn_id);
                }
            }
            "assistant.turn_end" => {
                state.detail.turns += 1;
                if let Some(scope) = state.current_scope.clone() {
                    if let ScopeRef::Turn { interaction, turn } = scope {
                        if let Some(t) = state
                            .conversation
                            .interactions
                            .get_mut(interaction)
                            .and_then(|i| i.turns.get_mut(turn))
                        {
                            t.completed_at = ts;
                            state.conversation.version += 1;
                        }
                    }
                }
            }
            "tool.execution_start" => {
                if let Some(name) = ev.data.get("toolName").and_then(|v| v.as_str()) {
                    *state.detail.tools_used.entry(name.to_string()).or_default() += 1;
                    if let Some(at) = ts {
                        let args_summary = ev.data.get("arguments").map(|v| truncate_value(v, 300));
                        let call_id = ev
                            .data
                            .get("toolCallId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        // Legacy flat list.
                        let idx = state.detail.tool_calls.len();
                        state.detail.tool_calls.push(ToolCall {
                            name: name.to_string(),
                            timestamp: at,
                            args_summary: args_summary.clone(),
                            result_snippet: None,
                            success: None,
                        });
                        if !call_id.is_empty() {
                            state.tool_call_index.insert(call_id.clone(), idx);
                        }

                        // Conversation log version.
                        let scope = state.ensure_active_turn(at);
                        if let Some(items) = state.scope_items_mut(&scope) {
                            items.push(TurnItem::Tool(TurnToolCall {
                                call_id: call_id.clone(),
                                name: name.to_string(),
                                at,
                                args_summary,
                                result_snippet: None,
                                success: None,
                            }));
                            let item_idx = items.len() - 1;
                            if !call_id.is_empty() {
                                state.tool_scope_map.insert(call_id, (scope, item_idx));
                            }
                            state.conversation.version += 1;
                        }
                    }
                }
            }
            "tool.execution_complete" => {
                let id = ev.data.get("toolCallId").and_then(|v| v.as_str());
                let success = ev.data.get("success").and_then(|v| v.as_bool());
                let result = ev
                    .data
                    .get("result")
                    .and_then(|r| r.get("content"))
                    .and_then(|v| v.as_str())
                    .map(|s| truncate_str(s, 300));
                if let Some(id) = id {
                    if let Some(&idx) = state.tool_call_index.get(id) {
                        if let Some(tc) = state.detail.tool_calls.get_mut(idx) {
                            if tc.result_snippet.is_none() {
                                tc.result_snippet = result.clone();
                            }
                            if tc.success.is_none() {
                                tc.success = success;
                            }
                        }
                    }
                    if let Some((scope, item_idx)) = state.tool_scope_map.get(id).cloned() {
                        if let Some(items) = state.scope_items_mut(&scope) {
                            if let Some(TurnItem::Tool(tc)) = items.get_mut(item_idx) {
                                if tc.result_snippet.is_none() {
                                    tc.result_snippet = result;
                                }
                                if tc.success.is_none() {
                                    tc.success = success;
                                }
                                state.conversation.version += 1;
                            }
                        }
                    }
                }
            }
            "subagent.started" => {
                if let Some(at) = ts {
                    let subagent_id = ev
                        .data
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let agent_type = ev
                        .data
                        .get("agentType")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let task = ev
                        .data
                        .get("description")
                        .or_else(|| ev.data.get("prompt"))
                        .and_then(|v| v.as_str())
                        .map(|s| {
                            let chars: String = s.chars().take(240).collect();
                            chars
                        });
                    let scope = state.ensure_active_turn(at);
                    if let Some(items) = state.scope_items_mut(&scope) {
                        items.push(TurnItem::Subagent(SubagentScope {
                            subagent_id,
                            started_at: at,
                            completed_at: None,
                            agent_type,
                            task,
                            items: Vec::new(),
                        }));
                        let item_idx = items.len() - 1;
                        // Push this subagent onto the scope stack.
                        state.current_scope = Some(state.descend_subagent(&scope, item_idx));
                        state.conversation.version += 1;
                    }
                }
            }
            "subagent.completed" => {
                if let Some(scope) = state.current_scope.clone() {
                    if let ScopeRef::Subagent { interaction, turn, mut path } = scope {
                        if let Some(last_idx) = path.last().copied() {
                            // Mark completed_at on the deepest subagent.
                            let parent_path = path[..path.len() - 1].to_vec();
                            let parent_scope = if parent_path.is_empty() {
                                ScopeRef::Turn { interaction, turn }
                            } else {
                                ScopeRef::Subagent {
                                    interaction,
                                    turn,
                                    path: parent_path.clone(),
                                }
                            };
                            if let Some(items) = state.scope_items_mut(&parent_scope) {
                                if let Some(TurnItem::Subagent(s)) = items.get_mut(last_idx) {
                                    s.completed_at = ts;
                                }
                            }
                            // Pop the subagent off the active scope.
                            path.pop();
                            state.current_scope = Some(if path.is_empty() {
                                ScopeRef::Turn { interaction, turn }
                            } else {
                                ScopeRef::Subagent { interaction, turn, path }
                            });
                            state.conversation.version += 1;
                        }
                    }
                }
            }
            "skill.invoked" => {
                if let Some(name) = ev.data.get("name").and_then(|v| v.as_str()) {
                    state.detail.skills_invoked.push(name.to_string());
                }
            }
            "session.model_change" => {
                if let Some(m) = ev.data.get("newModel").and_then(|v| v.as_str()) {
                    state.model = Some(m.to_string());
                }
            }
            "session.shutdown" => {
                if let Some(metrics) = ev.data.get("modelMetrics").and_then(|v| v.as_object()) {
                    let (mut tin, mut tout) = (0u64, 0u64);
                    for (_model, entry) in metrics {
                        let usage = entry.get("usage");
                        if let Some(u) = usage {
                            tin += u.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            tout += u.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        }
                    }
                    if tin > 0 || tout > 0 {
                        state.detail.tokens_in = tin;
                        state.detail.tokens_out = tout;
                    }
                }
            }
            _ => {}
        }
    }

    // Mirror the conversation log onto SessionDetail so anyone holding only
    // `state.detail` (e.g. cache layer) sees the latest. We Clone because
    // ConversationLog is already snapshot-friendly.
    state.detail.conversation = Some(state.conversation.clone());

    Ok(())
}

fn parse_ts(raw: Option<&str>) -> Option<chrono::DateTime<chrono::Utc>> {
    raw.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Best-effort heuristic: a Copilot user.message is "injected context"
/// when its raw content begins with a context wrapper tag (e.g.
/// `<skill-context>`, `<system-reminder>`, `<environment_context>`).
fn classify_user_message(raw: &str) -> UserMessageKind {
    let trimmed = raw.trim_start();
    if trimmed.starts_with("<skill-context")
        || trimmed.starts_with("<system-reminder")
        || trimmed.starts_with("<system_notification")
        || trimmed.starts_with("<environment_context")
        || trimmed.starts_with("<reminder")
    {
        UserMessageKind::InjectedContext
    } else {
        UserMessageKind::Human
    }
}

impl ParseState {
    /// Borrow the items vec the current scope points to. Returns None if
    /// the indices are stale (shouldn't happen in practice).
    fn scope_items_mut(&mut self, scope: &ScopeRef) -> Option<&mut Vec<TurnItem>> {
        match scope {
            ScopeRef::Turn { interaction, turn } => self
                .conversation
                .interactions
                .get_mut(*interaction)?
                .turns
                .get_mut(*turn)
                .map(|t| &mut t.items),
            ScopeRef::Subagent {
                interaction,
                turn,
                path,
            } => {
                let mut items = &mut self
                    .conversation
                    .interactions
                    .get_mut(*interaction)?
                    .turns
                    .get_mut(*turn)?
                    .items;
                for &idx in path.iter() {
                    if let Some(TurnItem::Subagent(s)) = items.get_mut(idx) {
                        items = &mut s.items;
                    } else {
                        return None;
                    }
                }
                Some(items)
            }
        }
    }

    /// Construct a child ScopeRef pointing into the subagent at `child_idx`
    /// inside the given parent scope.
    fn descend_subagent(&self, parent: &ScopeRef, child_idx: usize) -> ScopeRef {
        match parent {
            ScopeRef::Turn { interaction, turn } => ScopeRef::Subagent {
                interaction: *interaction,
                turn: *turn,
                path: vec![child_idx],
            },
            ScopeRef::Subagent {
                interaction,
                turn,
                path,
            } => {
                let mut p = path.clone();
                p.push(child_idx);
                ScopeRef::Subagent {
                    interaction: *interaction,
                    turn: *turn,
                    path: p,
                }
            }
        }
    }

    /// Ensure there is an active assistant turn; if not, synthesise one in
    /// the current interaction (or a synthetic interaction if there is no
    /// preceding user.message). Returns the resulting scope.
    fn ensure_active_turn(&mut self, at: chrono::DateTime<chrono::Utc>) -> ScopeRef {
        if let Some(scope) = self.current_scope.clone() {
            return scope;
        }
        // No open turn — start a synthetic one.
        let interaction_idx = match self.current_interaction {
            Some(i) => i,
            None => {
                self.conversation.interactions.push(Interaction {
                    interaction_id: format!("synthetic-{}", self.conversation.interactions.len()),
                    started_at: at,
                    kind: UserMessageKind::InjectedContext,
                    user_message_raw: None,
                    user_message_transformed: None,
                    turns: Vec::new(),
                });
                let i = self.conversation.interactions.len() - 1;
                self.current_interaction = Some(i);
                i
            }
        };
        let interaction = &mut self.conversation.interactions[interaction_idx];
        interaction.turns.push(AssistantTurn {
            turn_id: format!("synthetic-{}", interaction.turns.len()),
            started_at: at,
            completed_at: None,
            items: Vec::new(),
            usage: None,
        });
        let turn_idx = interaction.turns.len() - 1;
        let scope = ScopeRef::Turn {
            interaction: interaction_idx,
            turn: turn_idx,
        };
        self.current_scope = Some(scope.clone());
        scope
    }

    fn start_turn(&mut self, at: chrono::DateTime<chrono::Utc>, turn_id: String) {
        let interaction_idx = match self.current_interaction {
            Some(i) => i,
            None => {
                self.conversation.interactions.push(Interaction {
                    interaction_id: format!("synthetic-{}", self.conversation.interactions.len()),
                    started_at: at,
                    kind: UserMessageKind::InjectedContext,
                    user_message_raw: None,
                    user_message_transformed: None,
                    turns: Vec::new(),
                });
                let i = self.conversation.interactions.len() - 1;
                self.current_interaction = Some(i);
                i
            }
        };
        let interaction = &mut self.conversation.interactions[interaction_idx];
        interaction.turns.push(AssistantTurn {
            turn_id,
            started_at: at,
            completed_at: None,
            items: Vec::new(),
            usage: None,
        });
        let turn_idx = interaction.turns.len() - 1;
        self.current_scope = Some(ScopeRef::Turn {
            interaction: interaction_idx,
            turn: turn_idx,
        });
        self.conversation.version += 1;
    }
}

/// Truncate a string at a char boundary (not a byte boundary, to be safe with multibyte text).
fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars { return s.to_string(); }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// Stringify a JSON value, then truncate. For complex objects this gives a
/// compact summary line (no pretty-printing).
fn truncate_value(v: &serde_json::Value, max_chars: usize) -> String {
    let s = match v {
        serde_json::Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };
    truncate_str(&s, max_chars)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/copilot/4dac1bf8-ee21-4659-bc60-00aad57573fb/events.jsonl")
    }

    #[test]
    fn parses_full_file() {
        let mut s = ParseState::default();
        parse_incremental(&fixture(), &mut s).unwrap();
        assert_eq!(s.detail.user_messages, 1);
        assert_eq!(s.detail.assistant_messages, 1);
        assert_eq!(s.detail.turns, 1);
        assert_eq!(s.detail.tools_used.get("bash"), Some(&1));
        assert_eq!(s.detail.skills_invoked, vec!["brainstorming".to_string()]);
        assert_eq!(s.model.as_deref(), Some("claude-opus-4.7"));
    }

    #[test]
    fn second_call_is_idempotent() {
        let mut s = ParseState::default();
        parse_incremental(&fixture(), &mut s).unwrap();
        let before = s.detail.turns;
        parse_incremental(&fixture(), &mut s).unwrap();
        assert_eq!(s.detail.turns, before);
    }

    #[test]
    fn malformed_line_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("events.jsonl");
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(f, "{{\"type\":\"user.message\"}}").unwrap();
        writeln!(f, "this is not json").unwrap();
        writeln!(f, "{{\"type\":\"user.message\"}}").unwrap();
        let mut s = ParseState::default();
        parse_incremental(&p, &mut s).unwrap();
        assert_eq!(s.detail.user_messages, 2);
    }

    #[test]
    fn extracts_tokens_from_session_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("events.jsonl");
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(
            f,
            r#"{{"type":"session.shutdown","data":{{"modelMetrics":{{"gpt-5":{{"usage":{{"inputTokens":1000,"outputTokens":200}}}},"claude-opus":{{"usage":{{"inputTokens":500,"outputTokens":100}}}}}}}}}}"#
        )
        .unwrap();
        let mut s = ParseState::default();
        parse_incremental(&p, &mut s).unwrap();
        assert_eq!(s.detail.tokens_in, 1500);
        assert_eq!(s.detail.tokens_out, 300);
    }
}
