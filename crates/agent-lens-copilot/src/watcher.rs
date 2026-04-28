use crate::events;
use agent_lens_core::{CoreError, Result, SessionEvent};
use notify::{Config, PollWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;

pub async fn run(
    root: PathBuf,
    states: Arc<RwLock<HashMap<String, events::ParseState>>>,
    tx: mpsc::Sender<SessionEvent>,
) -> Result<()> {
    if !root.exists() {
        tokio::fs::create_dir_all(&root).await.ok();
    }
    // FSEvents on macOS reports canonical paths (e.g. /private/var/...). Canonicalize
    // root so path stripping works for both real and symlinked tmp dirs.
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    let (raw_tx, mut raw_rx) = mpsc::channel::<notify::Event>(256);
    let handle = tokio::runtime::Handle::current();
    // PollWatcher with compare_contents=true: macOS HFS+/APFS mtime can have low
    // resolution, so we explicitly hash file contents to detect appends reliably.
    let cfg = Config::default()
        .with_poll_interval(Duration::from_millis(250))
        .with_compare_contents(true);
    let mut watcher: PollWatcher = PollWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                let h = handle.clone();
                let sender = raw_tx.clone();
                h.spawn(async move {
                    let _ = sender.send(ev).await;
                });
            }
        },
        cfg,
    )
    .map_err(|e| CoreError::Parse(e.to_string()))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| CoreError::Parse(e.to_string()))?;

    let mut interval = tokio::time::interval(Duration::from_millis(200));
    let mut dirty: HashSet<String> = HashSet::new();
    loop {
        tokio::select! {
            Some(ev) = raw_rx.recv() => {
                for path in ev.paths {
                    if let Ok(rel) = path.strip_prefix(&root) {
                        if let Some(first) = rel.iter().next() {
                            dirty.insert(first.to_string_lossy().to_string());
                        }
                    }
                }
            }
            _ = interval.tick() => {
                if dirty.is_empty() { continue; }
                let _ = tx.send(SessionEvent::SessionListChanged).await;
                for id in dirty.drain() {
                    let path = root.join(&id).join("events.jsonl");
                    let detail = {
                        let mut g = states.write().unwrap();
                        let st = g.entry(id.clone()).or_default();
                        let _ = events::parse_incremental(&path, st);
                        st.detail.clone()
                    };
                    let _ = tx.send(SessionEvent::DetailUpdated { session_id: id, detail }).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn watcher_emits_detail_after_append() {
        let dir = tempfile::tempdir().unwrap();
        let sid = "abc";
        let session_dir = dir.path().join(sid);
        std::fs::create_dir(&session_dir).unwrap();
        let evp = session_dir.join("events.jsonl");
        std::fs::write(&evp, "").unwrap();
        let states = Arc::new(RwLock::new(HashMap::new()));
        let (tx, mut rx) = mpsc::channel(64);
        let root = dir.path().to_path_buf();
        let s2 = states.clone();
        tokio::spawn(async move {
            let _ = run(root, s2, tx).await;
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut f = std::fs::OpenOptions::new().append(true).open(&evp).unwrap();
        writeln!(f, "{{\"type\":\"user.message\"}}").unwrap();
        f.sync_all().unwrap();
        let recv = tokio::time::timeout(Duration::from_millis(3000), async {
            while let Some(ev) = rx.recv().await {
                if let SessionEvent::DetailUpdated { session_id, detail } = ev {
                    if session_id == sid && detail.user_messages >= 1 {
                        return true;
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        assert!(recv, "expected DetailUpdated within 3000ms");
    }
}
