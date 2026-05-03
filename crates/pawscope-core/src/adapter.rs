use crate::error::Result;
use crate::types::{ConversationLog, SessionDetail, SessionMeta};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionEvent {
    SessionListChanged,
    DetailUpdated {
        session_id: String,
        detail: Box<SessionDetail>,
    },
    Closed {
        session_id: String,
    },
    /// Emitted when an adapter's per-session conversation log mutates.
    /// Carries only the new version cursor so the wire payload stays
    /// tiny; clients refetch `/api/sessions/:id/conversation` (optionally
    /// with `?since_version=N` once delta support lands).
    ConversationUpdated {
        session_id: String,
        version: u64,
    },
}

#[async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>>;
    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail>;
    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()>;

    /// Aggregate event counts into hourly buckets for the trailing window.
    ///
    /// Returns a `hours`-length vector ordered oldest → newest. The default
    /// implementation returns an empty vector for adapters that don't track
    /// fine-grained timestamps.
    /// Aggregate event counts into hourly buckets for the trailing window.
    ///
    /// Returns a `hours`-length vector ordered oldest → newest. The default
    /// implementation returns an empty vector for adapters that don't track
    /// fine-grained timestamps.
    async fn activity_hourly(&self, _hours: u32) -> Result<Vec<u64>> {
        Ok(Vec::new())
    }

    /// Per-session hourly activity bucket (oldest → newest).
    ///
    /// Returns a `hours`-length vector for a single session. Adapters without
    /// per-event timestamps return an empty vector (callers should fall back
    /// to coarser metrics).
    async fn session_activity_hourly(&self, _session_id: &str, _hours: u32) -> Result<Vec<u64>> {
        Ok(Vec::new())
    }

    /// 7×24 grid of hourly event counts in local time, indexed by `[days_ago][hour_of_day]`.
    /// `days_ago` 0 = today; rows ordered today → 6 days ago. Hours are server-local.
    /// Default returns an empty grid for adapters that don't track timestamps.
    async fn activity_grid_7x24(&self) -> Result<Vec<Vec<u64>>> {
        Ok(vec![vec![0; 24]; 7])
    }

    /// Full structured conversation log for a session: system prompts,
    /// compaction markers, and interactions (each with one or more
    /// assistant turns). Adapters that don't yet support the structured
    /// flow should return `Ok(None)` (the default).
    async fn get_conversation(&self, _session_id: &str) -> Result<Option<ConversationLog>> {
        Ok(None)
    }

    /// Whether this adapter supports deleting (moving to trash) sessions.
    fn supports_delete(&self) -> bool {
        false
    }

    /// Delete a session by moving its data to the trash directory.
    /// Returns the trash path as a string.
    async fn delete_session(&self, _session_id: &str) -> Result<String> {
        Err(crate::CoreError::NotFound("delete not supported".into()))
    }
}
