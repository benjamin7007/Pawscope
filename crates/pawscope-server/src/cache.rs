use pawscope_core::{AgentAdapter, SessionDetail, SessionMeta};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const TTL: Duration = Duration::from_secs(15);
const CONCURRENCY: usize = 8;

type Entry = (Instant, Arc<SessionDetail>);
type Store = Arc<RwLock<HashMap<String, Entry>>>;

#[derive(Clone, Default)]
pub struct DetailCache {
    inner: Store,
}

impl DetailCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get_or_fetch(
        &self,
        adapter: &Arc<dyn AgentAdapter>,
        id: &str,
    ) -> Option<Arc<SessionDetail>> {
        if let Some((at, d)) = self.inner.read().await.get(id) {
            if at.elapsed() < TTL {
                return Some(d.clone());
            }
        }
        let detail = adapter.get_detail(id).await.ok()?;
        let arc = Arc::new(detail);
        self.inner
            .write()
            .await
            .insert(id.to_string(), (Instant::now(), arc.clone()));
        Some(arc)
    }

    pub async fn invalidate(&self, id: &str) {
        self.inner.write().await.remove(id);
    }

    pub async fn fan_out(
        &self,
        adapter: &Arc<dyn AgentAdapter>,
        sessions: &[SessionMeta],
    ) -> Vec<(SessionMeta, Arc<SessionDetail>)> {
        use futures::stream::{self, StreamExt};
        let owned: Vec<SessionMeta> = sessions.to_vec();
        stream::iter(owned.into_iter().map(|s| {
            let cache = self.clone();
            let adapter = adapter.clone();
            async move {
                let d = cache.get_or_fetch(&adapter, &s.id).await;
                (s, d)
            }
        }))
        .buffer_unordered(CONCURRENCY)
        .filter_map(|(s, d)| async move { d.map(|d| (s, d)) })
        .collect()
        .await
    }
}
