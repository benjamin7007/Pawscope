use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub cwd: String,
    pub repository: Option<String>,
    pub branch: Option<String>,
    #[serde(default)]
    pub summary: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub fn parse(path: &Path) -> anyhow::Result<Workspace> {
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_yaml::from_str(&raw)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    #[test]
    fn parses_real_workspace_yaml() {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
            "../../tests/fixtures/copilot/4dac1bf8-ee21-4659-bc60-00aad57573fb/workspace.yaml",
        );
        let ws = parse(&p).unwrap();
        assert_eq!(ws.id, "4dac1bf8-ee21-4659-bc60-00aad57573fb");
        assert_eq!(ws.repository.as_deref(), Some("test/repo"));
        assert_eq!(ws.branch.as_deref(), Some("master"));
    }
}
