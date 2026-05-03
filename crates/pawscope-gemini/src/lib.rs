//! Gemini CLI adapter — stub for future `~/.gemini/` session support.
//!
//! Currently a placeholder that returns empty results. When the Gemini CLI
//! ships a stable session format, this adapter will be fleshed out.

use async_trait::async_trait;
use pawscope_core::{AgentAdapter, CoreError, Result, SessionDetail, SessionEvent, SessionMeta};
use std::path::PathBuf;
use tokio::sync::mpsc;

pub struct GeminiAdapter {
    #[allow(dead_code)]
    root: PathBuf,
}

impl GeminiAdapter {
    pub fn new() -> Result<Self> {
        let root = std::env::var("GEMINI_STATE_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| dirs::home_dir().map(|h| h.join(".gemini")))
            .ok_or_else(|| CoreError::NotFound("gemini state dir".into()))?;

        if !root.exists() {
            return Err(CoreError::NotFound(format!(
                "gemini dir not found: {}",
                root.display()
            )));
        }

        Ok(Self { root })
    }
}

#[async_trait]
impl AgentAdapter for GeminiAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        Ok(vec![])
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        Err(CoreError::NotFound(format!(
            "gemini session not found: {session_id}"
        )))
    }

    async fn watch(&self, _tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_list_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("GEMINI_STATE_DIR", dir.path()) };
        let adapter = GeminiAdapter::new().unwrap();
        let sessions = adapter.list_sessions().await.unwrap();
        assert!(sessions.is_empty());
        unsafe { std::env::remove_var("GEMINI_STATE_DIR") };
    }

    #[tokio::test]
    async fn stub_detail_returns_not_found() {
        let dir = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("GEMINI_STATE_DIR", dir.path()) };
        let adapter = GeminiAdapter::new().unwrap();
        let err = adapter.get_detail("any-id").await;
        assert!(err.is_err());
        unsafe { std::env::remove_var("GEMINI_STATE_DIR") };
    }
}
