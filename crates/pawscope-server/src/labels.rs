use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Label {
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Label {
    pub fn is_empty(&self) -> bool {
        !self.starred && self.tags.is_empty()
            && self.note.as_deref().map(str::is_empty).unwrap_or(true)
    }
}

#[derive(Clone)]
pub struct LabelStore {
    path: PathBuf,
    inner: Arc<RwLock<HashMap<String, Label>>>,
}

fn default_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pawscope")
        .join("labels.json")
}

impl LabelStore {
    pub async fn load() -> Self {
        Self::load_from(default_path()).await
    }

    pub async fn load_from(path: PathBuf) -> Self {
        let map = tokio::fs::read_to_string(&path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, Label>>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Arc::new(RwLock::new(map)),
        }
    }

    pub async fn snapshot(&self) -> HashMap<String, Label> {
        self.inner.read().await.clone()
    }

    pub async fn get(&self, id: &str) -> Label {
        self.inner.read().await.get(id).cloned().unwrap_or_default()
    }

    pub async fn set(&self, id: &str, label: Label) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            if label.is_empty() {
                g.remove(id);
            } else {
                g.insert(id.to_string(), label);
            }
        }
        self.persist().await
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
