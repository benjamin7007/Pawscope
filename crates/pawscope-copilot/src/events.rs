use pawscope_core::types::SessionDetail;
use serde::Deserialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Event<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(default)]
    data: serde_json::Value,
}

#[derive(Debug, Default, Clone)]
pub struct ParseState {
    pub offset: u64,
    pub detail: SessionDetail,
    pub model: Option<String>,
}

pub fn parse_incremental(path: &Path, state: &mut ParseState) -> anyhow::Result<()> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    if len < state.offset {
        state.offset = 0;
        state.detail = SessionDetail::default();
        state.model = None;
    }
    if len == state.offset {
        return Ok(());
    }
    f.seek(SeekFrom::Start(state.offset))?;
    let mut reader = BufReader::new(f);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            break;
        }
        if !line.ends_with('\n') {
            break;
        }
        state.offset += n as u64;
        let trimmed = line.trim_end();
        let ev: Event = match serde_json::from_str(trimmed) {
            Ok(e) => e,
            Err(_) => continue,
        };
        match ev.kind {
            "user.message" => state.detail.user_messages += 1,
            "assistant.message" => state.detail.assistant_messages += 1,
            "assistant.turn_end" => state.detail.turns += 1,
            "tool.execution_start" => {
                if let Some(name) = ev.data.get("toolName").and_then(|v| v.as_str()) {
                    *state.detail.tools_used.entry(name.to_string()).or_default() += 1;
                }
            }
            "skill.invoked" => {
                if let Some(name) = ev.data.get("name").and_then(|v| v.as_str()) {
                    state.detail.skills_invoked.push(name.to_string());
                }
            }
            "session.model_change" => {
                if let Some(m) = ev.data.get("newModel").and_then(|v| v.as_str()) {
                    state.model = Some(m.to_string());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/copilot/4dac1bf8-ee21-4659-bc60-00aad57573fb/events.jsonl")
    }

    #[test]
    fn parses_full_file() {
        let mut s = ParseState::default();
        parse_incremental(&fixture(), &mut s).unwrap();
        assert_eq!(s.detail.user_messages, 1);
        assert_eq!(s.detail.assistant_messages, 1);
        assert_eq!(s.detail.turns, 1);
        assert_eq!(s.detail.tools_used.get("bash"), Some(&1));
        assert_eq!(s.detail.skills_invoked, vec!["brainstorming".to_string()]);
        assert_eq!(s.model.as_deref(), Some("claude-opus-4.7"));
    }

    #[test]
    fn second_call_is_idempotent() {
        let mut s = ParseState::default();
        parse_incremental(&fixture(), &mut s).unwrap();
        let before = s.detail.turns;
        parse_incremental(&fixture(), &mut s).unwrap();
        assert_eq!(s.detail.turns, before);
    }

    #[test]
    fn malformed_line_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("events.jsonl");
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(f, "{{\"type\":\"user.message\"}}").unwrap();
        writeln!(f, "this is not json").unwrap();
        writeln!(f, "{{\"type\":\"user.message\"}}").unwrap();
        let mut s = ParseState::default();
        parse_incremental(&p, &mut s).unwrap();
        assert_eq!(s.detail.user_messages, 2);
    }
}
