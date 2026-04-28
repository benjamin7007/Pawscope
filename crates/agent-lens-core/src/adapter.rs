use crate::error::Result;
use crate::types::{SessionDetail, SessionMeta};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionEvent {
    SessionListChanged,
    DetailUpdated {
        session_id: String,
        detail: SessionDetail,
    },
    Closed {
        session_id: String,
    },
}

#[async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>>;
    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail>;
    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()>;
}
