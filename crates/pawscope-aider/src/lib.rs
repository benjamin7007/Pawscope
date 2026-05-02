//! Aider adapter — stub for future `.aider.chat.history.md` support.
//!
//! Aider stores per-project chat history as `.aider.chat.history.md` files.
//! There is no central state directory; discovery requires scanning project
//! roots. This stub returns empty results until the scanner is implemented.

use async_trait::async_trait;
use pawscope_core::{
    AgentAdapter, CoreError, Result, SessionDetail, SessionEvent, SessionMeta,
};
use std::path::PathBuf;
use tokio::sync::mpsc;

pub struct AiderAdapter {
    #[allow(dead_code)]
    roots: Vec<PathBuf>,
}

impl AiderAdapter {
    pub fn new() -> Result<Self> {
        let root = std::env::var("AIDER_STATE_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| dirs::home_dir().map(|h| h.join(".aider")))
            .ok_or_else(|| CoreError::NotFound("aider state dir".into()))?;

        if !root.exists() {
            return Err(CoreError::NotFound(format!(
                "aider dir not found: {}",
                root.display()
            )));
        }

        Ok(Self { roots: vec![root] })
    }
}

#[async_trait]
impl AgentAdapter for AiderAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        Ok(vec![])
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        Err(CoreError::NotFound(format!(
            "aider session not found: {session_id}"
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
        unsafe { std::env::set_var("AIDER_STATE_DIR", dir.path()) };
        let adapter = AiderAdapter::new().unwrap();
        let sessions = adapter.list_sessions().await.unwrap();
        assert!(sessions.is_empty());
        unsafe { std::env::remove_var("AIDER_STATE_DIR") };
    }

    #[tokio::test]
    async fn stub_detail_returns_not_found() {
        let dir = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("AIDER_STATE_DIR", dir.path()) };
        let adapter = AiderAdapter::new().unwrap();
        let err = adapter.get_detail("any-id").await;
        assert!(err.is_err());
        unsafe { std::env::remove_var("AIDER_STATE_DIR") };
    }
}
