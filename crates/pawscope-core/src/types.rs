use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Active,
    Idle,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Copilot,
    Claude,
    Codex,
    OpenCode,
    Gemini,
    Aider,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub agent: AgentKind,
    pub cwd: PathBuf,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub summary: String,
    pub model: Option<String>,
    pub status: SessionStatus,
    pub pid: Option<u32>,
    pub started_at: DateTime<Utc>,
    pub last_event_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubagentSummary {
    pub id: String,
    pub turns: u32,
    pub tool_calls: u32,
    #[serde(default)]
    pub tools: HashMap<String, u32>,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub active: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptSummary {
    pub id: String,
    pub timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub snippet: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Truncated stringification of the tool's input arguments (~300 chars).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_summary: Option<String>,
    /// Truncated snippet of the tool's result/output (~300 chars).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_snippet: Option<String>,
    /// Whether the tool succeeded (when known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionDetail {
    pub turns: u32,
    pub user_messages: u32,
    pub assistant_messages: u32,
    pub tools_used: HashMap<String, u32>,
    pub skills_invoked: Vec<String>,
    #[serde(default)]
    pub subagents: Vec<SubagentSummary>,
    #[serde(default)]
    pub prompts: Vec<PromptSummary>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub tokens_in: u64,
    #[serde(default)]
    pub tokens_out: u64,
    /// Structured agent ↔ LLM ↔ tool conversation log. Populated only by
    /// adapters that support the full flow (Copilot in v0.6). Not exposed
    /// on summary-flavored API responses to keep payloads small; the
    /// `/api/sessions/:id/conversation` endpoint serves the full log.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation: Option<ConversationLog>,
}

// ============================================================================
// Conversation flow (v0.6) — Copilot only for now.
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConversationLog {
    /// Monotonically increasing version, bumped on each mutation. Used by
    /// WebSocket clients to detect missed updates and request resync via
    /// `/api/sessions/:id/conversation?since_version=N`.
    pub version: u64,
    #[serde(default)]
    pub system_prompts: Vec<SystemPromptMarker>,
    #[serde(default)]
    pub compaction_markers: Vec<CompactionMarker>,
    #[serde(default)]
    pub interactions: Vec<Interaction>,
    /// Aggregate token + cost usage across all turns in this conversation.
    /// `None` if the adapter does not surface token usage for this session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<TokenSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemPromptMarker {
    pub at: DateTime<Utc>,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionMarker {
    pub started_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserMessageKind {
    /// A genuine human-typed message.
    Human,
    /// Synthetic context injected by the runtime (skill loads, reminders,
    /// system notifications). The user did not type these.
    InjectedContext,
}

impl Default for UserMessageKind {
    fn default() -> Self { Self::Human }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interaction {
    pub interaction_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(default)]
    pub kind: UserMessageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_message_raw: Option<String>,
    /// What the LLM actually received (datetime + reminders injected).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_message_transformed: Option<String>,
    #[serde(default)]
    pub turns: Vec<AssistantTurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantTurn {
    pub turn_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub items: Vec<TurnItem>,
    /// Per-turn token + cost breakdown. Populated by adapters that expose
    /// usage events (Claude `message.usage`, Codex `token_count`, Copilot
    /// `outputTokens`). `None` for older sessions or adapters without data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TurnUsage>,
}

/// Token + cost usage for a single assistant turn.
///
/// All token counts are absolute (not deltas) for that turn. `cost_usd` is
/// computed at parse time using the static rate table in
/// [`crate::pricing`]; downstream consumers should treat it as
/// best-effort, not invoice-grade.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TurnUsage {
    /// Model identifier reported by the adapter (e.g. `claude-sonnet-4-5-20250929`).
    /// Stored verbatim; pricing logic normalizes via `pricing::normalize_model`.
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    /// Tokens served from prompt cache (Anthropic only — billed at 0.1x input).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    /// Tokens written to prompt cache (Anthropic only — billed at 1.25x input).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
    /// Estimated USD cost for this turn. `None` if model is unknown to the
    /// pricing table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

/// Per-model rollup inside a [`TokenSummary`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ModelUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub turn_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

/// Conversation-level rollup of all per-turn [`TurnUsage`] entries.
///
/// Recomputed at the end of each parse cycle by adapters; never mutated
/// incrementally.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TokenSummary {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cache_write_tokens: u64,
    pub turn_count: u64,
    /// Sum of per-turn costs that had a known model; turns with unknown
    /// models are excluded so the displayed total never silently undercounts
    /// without a hint. UI should show "incomplete" when
    /// `turns_with_known_model < turn_count`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
    pub turns_with_known_model: u64,
    /// Per-model breakdown keyed by the *normalized* model name.
    #[serde(default)]
    pub by_model: std::collections::BTreeMap<String, ModelUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnItem {
    AssistantMessage {
        at: DateTime<Utc>,
        content: String,
    },
    Tool(TurnToolCall),
    Subagent(SubagentScope),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TurnToolCall {
    pub call_id: String,
    pub name: String,
    pub at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_snippet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentScope {
    pub subagent_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    /// Tool calls and assistant messages emitted while the subagent ran.
    #[serde(default)]
    pub items: Vec<TurnItem>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_status_round_trip() {
        let s = serde_json::to_string(&SessionStatus::Active).unwrap();
        assert_eq!(s, "\"active\"");
        let back: SessionStatus = serde_json::from_str(&s).unwrap();
        assert_eq!(back, SessionStatus::Active);
    }
}
