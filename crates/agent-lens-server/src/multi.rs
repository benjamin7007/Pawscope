//! Fan-out adapter that combines multiple `AgentAdapter`s into one.

use agent_lens_core::{AgentAdapter, Result, SessionDetail, SessionEvent, SessionMeta};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct MultiAdapter {
    adapters: Vec<Arc<dyn AgentAdapter>>,
}

impl MultiAdapter {
    pub fn new(adapters: Vec<Arc<dyn AgentAdapter>>) -> Self {
        Self { adapters }
    }
}

#[async_trait]
impl AgentAdapter for MultiAdapter {
    async fn list_sessions(&self) -> Result<Vec<SessionMeta>> {
        let mut out = Vec::new();
        for a in &self.adapters {
            if let Ok(mut v) = a.list_sessions().await {
                out.append(&mut v);
            }
        }
        out.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        Ok(out)
    }

    async fn get_detail(&self, session_id: &str) -> Result<SessionDetail> {
        let mut last_err = None;
        for a in &self.adapters {
            match a.get_detail(session_id).await {
                Ok(d) => return Ok(d),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err
            .unwrap_or_else(|| agent_lens_core::CoreError::NotFound(session_id.to_string())))
    }

    async fn watch(&self, tx: mpsc::Sender<SessionEvent>) -> Result<()> {
        let mut handles = Vec::new();
        for a in &self.adapters {
            let a = a.clone();
            let tx = tx.clone();
            handles.push(tokio::spawn(async move {
                let _ = a.watch(tx).await;
            }));
        }
        for h in handles {
            let _ = h.await;
        }
        Ok(())
    }

    async fn activity_hourly(&self, hours: u32) -> Result<Vec<u64>> {
        let mut combined: Vec<u64> = vec![0; hours as usize];
        for a in &self.adapters {
            if let Ok(b) = a.activity_hourly(hours).await {
                for (i, v) in b.into_iter().enumerate() {
                    if let Some(slot) = combined.get_mut(i) {
                        *slot += v;
                    }
                }
            }
        }
        Ok(combined)
    }

    async fn activity_grid_7x24(&self) -> Result<Vec<Vec<u64>>> {
        let mut grid = vec![vec![0u64; 24]; 7];
        for a in &self.adapters {
            if let Ok(g) = a.activity_grid_7x24().await {
                for (d, row) in g.iter().enumerate().take(7) {
                    for (h, v) in row.iter().enumerate().take(24) {
                        grid[d][h] += *v;
                    }
                }
            }
        }
        Ok(grid)
    }
}

// suppress unused import on certain feature combos
#[allow(dead_code)]
fn _typecheck() -> HashMap<String, ()> {
    HashMap::new()
}
