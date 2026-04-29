use axum::{
    Router,
    routing::{get, post},
};
use pawscope_core::AgentAdapter;
use std::sync::Arc;
use tokio::sync::broadcast;

pub mod api;
pub mod assets;
pub mod multi;
pub mod skills;
pub mod sse;
pub mod ws;

pub use multi::MultiAdapter;

#[derive(Clone)]
pub struct AppState {
    pub adapter: Arc<dyn AgentAdapter>,
    pub events: broadcast::Sender<pawscope_core::SessionEvent>,
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
        .route("/api/activity", get(api::activity))
        .route("/api/activity/grid", get(api::activity_grid))
        .route("/api/realms", get(api::realm_detail))
        .route("/api/prompts/search", get(api::prompts_search))
        .route("/api/tools/trend", get(api::tools_trend))
        .route("/api/tools/bucket", get(api::tools_bucket))
        .route("/api/skills", get(skills::list_skills))
        .route("/api/skills/content", get(skills::skill_content))
        .route("/api/skills/usage", get(skills::skill_usage))
        .route("/api/skills/reveal", post(skills::skill_reveal))
        .route("/api/events", get(sse::sse_handler))
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
    use async_trait::async_trait;
    use pawscope_core::*;
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
