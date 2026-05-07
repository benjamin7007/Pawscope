use axum::{
    Router,
    routing::{delete, get, post},
};
use pawscope_core::AgentAdapter;
use std::sync::Arc;
use tokio::sync::broadcast;

pub mod api;
pub mod assets;
pub mod auth;
pub mod cache;
pub mod hidden;
pub mod labels;
pub mod multi;
pub mod my_skills;
pub mod skills;
pub mod sse;
pub mod store;
pub mod sync;
pub mod ws;

pub use multi::MultiAdapter;

#[derive(Clone)]
pub struct AppState {
    pub adapter: Arc<dyn AgentAdapter>,
    pub events: broadcast::Sender<pawscope_core::SessionEvent>,
    pub detail_cache: cache::DetailCache,
    pub labels: labels::LabelStore,
    pub hidden: hidden::HiddenStore,
    pub my_skills: my_skills::MySkillsStore,
    pub auth: auth::AuthStore,
}

pub fn build_app(adapter: Arc<dyn AgentAdapter>) -> (Router, AppState) {
    let (tx, _) = broadcast::channel(256);
    let labels = futures::executor::block_on(labels::LabelStore::load());
    let hidden = futures::executor::block_on(hidden::HiddenStore::load());
    let my_skills = futures::executor::block_on(my_skills::MySkillsStore::load());
    let auth = futures::executor::block_on(auth::AuthStore::load());
    let state = AppState {
        adapter,
        events: tx,
        detail_cache: cache::DetailCache::new(),
        labels,
        hidden,
        my_skills,
        auth,
    };
    let router = Router::new()
        .route("/api/sessions", get(api::list_sessions))
        .route("/api/sessions/tokens", get(api::sessions_tokens))
        .route("/api/sessions/pulse", get(api::sessions_pulse))
        .route("/api/sessions/hidden", get(api::list_hidden))
        .route(
            "/api/sessions/{id}",
            get(api::get_detail).delete(api::delete_session),
        )
        .route("/api/sessions/{id}/hide", post(api::hide_session))
        .route("/api/sessions/{id}/unhide", post(api::unhide_session))
        .route(
            "/api/sessions/{id}/conversation",
            get(api::get_conversation),
        )
        .route(
            "/api/sessions/{id}/context",
            get(api::get_session_context),
        )
        .route("/api/overview", get(api::overview))
        .route("/api/activity", get(api::activity))
        .route("/api/activity/grid", get(api::activity_grid))
        .route("/api/realms", get(api::realm_detail))
        .route("/api/prompts/search", get(api::prompts_search))
        .route("/api/prompts/wordcloud", get(api::prompts_wordcloud))
        .route("/api/prompts/length", get(api::prompts_length))
        .route("/api/prompts/techstack", get(api::techstack))
        .route("/api/activity/weekly", get(api::activity_weekly))
        .route("/api/activity/heartbeat", get(api::activity_heartbeat))
        .route("/api/tools/dangerous", get(api::tools_dangerous))
        .route("/api/files/hot", get(api::files_hot))
        .route("/api/tools/trend", get(api::tools_trend))
        .route("/api/tools/bucket", get(api::tools_bucket))
        .route("/api/labels", get(api::list_labels))
        .route("/api/labels/{id}", post(api::set_label))
        .route("/api/skills", get(skills::list_skills))
        .route("/api/skills/content", get(skills::skill_content))
        .route("/api/skills/usage", get(skills::skill_usage))
        .route("/api/skills/reveal", post(skills::skill_reveal))
        .route("/api/sessions/{id}/skills", get(skills::session_skills))
        .route(
            "/api/sessions/{id}/instructions",
            get(api::get_session_instructions),
        )
        .route("/api/config/copilot", get(api::copilot_config))
        .route("/api/config/agents", get(api::all_agents_config))
        .route("/api/store/catalog", get(store::store_catalog))
        .route("/api/store/skill/{name}", get(store::store_skill_detail))
        .route("/api/store/install", post(store::store_install))
        .route("/api/store/uninstall", post(store::store_uninstall))
        .route("/api/store/refresh", post(store::store_refresh))
        .route(
            "/api/my-skills",
            get(my_skills::list_my_skills).post(my_skills::add_my_skill),
        )
        .route("/api/my-skills/reorder", post(my_skills::reorder_my_skills))
        .route(
            "/api/my-skills/auto-categorize",
            post(my_skills::auto_categorize),
        )
        .route(
            "/api/my-skills/{id}",
            delete(my_skills::remove_my_skill).patch(my_skills::update_my_skill),
        )
        .route("/api/analytics", get(api::analytics))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/status", get(auth::status))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/sync/push", post(sync::push))
        .route("/api/sync/pull", post(sync::pull))
        .route("/api/sync/sync", post(sync::sync_all))
        .route("/api/sync/remote-skills", get(sync::remote_skills))
        .route("/api/sync/info", get(sync::sync_info))
        .route("/api/skills/install", post(sync::install_skill))
        .route("/api/projects", get(api::list_projects))
        .route("/api/open-dir", post(api::open_dir))
        .route("/api/events", get(sse::sse_handler))
        .route("/ws", get(ws::ws_handler))
        .fallback(assets::static_handler)
        .with_state(state.clone());
    (router, state)
}

pub fn spawn_watcher(state: AppState) {
    let adapter = state.adapter.clone();
    let tx = state.events.clone();
    let cache = state.detail_cache.clone();
    tokio::spawn(async move {
        let (m_tx, mut m_rx) = tokio::sync::mpsc::channel(256);
        tokio::spawn(async move {
            let _ = adapter.watch(m_tx).await;
        });
        while let Some(ev) = m_rx.recv().await {
            match &ev {
                pawscope_core::SessionEvent::DetailUpdated { session_id, .. }
                | pawscope_core::SessionEvent::Closed { session_id } => {
                    cache.invalidate(session_id).await;
                }
                pawscope_core::SessionEvent::ConversationUpdated { .. } => {}
                pawscope_core::SessionEvent::SessionListChanged => {}
            }
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

    #[tokio::test]
    async fn copilot_config_returns_valid_json() {
        let (router, _) = build_app(Arc::new(MockAdapter));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let resp = reqwest::get(format!("http://{}/api/config/copilot", addr))
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert!(body.is_object());
        assert!(body.get("plugins").unwrap().is_array());
        assert!(body.get("skills_count").unwrap().is_number());
        // instructions, model, effort_level may be null or string
        let instr = body.get("instructions").unwrap();
        assert!(instr.is_null() || instr.is_string());
    }
}
