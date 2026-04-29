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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptSummary {
    pub id: String,
    pub timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub snippet: String,
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
