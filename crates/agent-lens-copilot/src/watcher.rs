// filled in Task 7
use crate::events;
use agent_lens_core::{Result, SessionEvent};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

pub async fn run(
    _root: PathBuf,
    _states: Arc<RwLock<HashMap<String, events::ParseState>>>,
    _tx: mpsc::Sender<SessionEvent>,
) -> Result<()> {
    // implemented in Task 7
    Ok(())
}
