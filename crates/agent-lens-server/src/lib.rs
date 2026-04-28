use agent_lens_core::AgentAdapter;
use axum::{Router, routing::get};
use std::sync::Arc;
use tokio::sync::broadcast;

pub mod api;
pub mod assets;
pub mod ws;

#[derive(Clone)]
pub struct AppState {
    pub adapter: Arc<dyn AgentAdapter>,
    pub events: broadcast::Sender<agent_lens_core::SessionEvent>,
}

pub fn build_app(adapter: Arc<dyn AgentAdapter>) -> (Router, AppState) {
    let (tx, _) = broadcast::channel(256);
    let state = AppState {
        adapter,
        events: tx,
    };
    let router = Router::new()
        .route("/api/sessions", get(api::list_sessions))
        .route("/api/sessions/{id}", get(api::get_detail))
        .route("/api/overview", get(api::overview))
        .route("/ws", get(ws::ws_handler))
        .fallback(assets::static_handler)
        .with_state(state.clone());
    (router, state)
}

pub fn spawn_watcher(state: AppState) {
    let adapter = state.adapter.clone();
    let tx = state.events.clone();
    tokio::spawn(async move {
        let (m_tx, mut m_rx) = tokio::sync::mpsc::channel(256);
        tokio::spawn(async move {
            let _ = adapter.watch(m_tx).await;
        });
        while let Some(ev) = m_rx.recv().await {
            let _ = tx.send(ev);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_lens_core::*;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    struct MockAdapter;
    #[async_trait]
    impl AgentAdapter for MockAdapter {
        async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
            Ok(vec![])
        }
        async fn get_detail(&self, _: &str) -> Result<SessionDetail> {
            Ok(SessionDetail::default())
        }
        async fn watch(&self, _: mpsc::Sender<SessionEvent>) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn list_sessions_returns_json_array() {
        let (router, _) = build_app(Arc::new(MockAdapter));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let body: serde_json::Value = reqwest::get(format!("http://{}/api/sessions", addr))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(body.is_array());
    }
}
