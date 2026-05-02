use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct HiddenStore {
    path: PathBuf,
    inner: Arc<RwLock<HashSet<String>>>,
}

fn default_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pawscope")
        .join("hidden.json")
}

impl HiddenStore {
    pub async fn load() -> Self {
        Self::load_from(default_path()).await
    }

    pub async fn load_from(path: PathBuf) -> Self {
        let set = tokio::fs::read_to_string(&path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<HashSet<String>>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Arc::new(RwLock::new(set)),
        }
    }

    pub async fn is_hidden(&self, id: &str) -> bool {
        self.inner.read().await.contains(id)
    }

    pub async fn hide(&self, id: &str) -> std::io::Result<()> {
        {
            self.inner.write().await.insert(id.to_string());
        }
        self.persist().await
    }

    pub async fn unhide(&self, id: &str) -> std::io::Result<()> {
        {
            self.inner.write().await.remove(id);
        }
        self.persist().await
    }

    pub async fn snapshot(&self) -> HashSet<String> {
        self.inner.read().await.clone()
    }

    async fn persist(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let snap = self.inner.read().await;
        let body = serde_json::to_string_pretty(&*snap).map_err(std::io::Error::other)?;
        tokio::fs::write(&self.path, body).await
    }
}
