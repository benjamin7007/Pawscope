use pawscope_core::types::{SessionDetail, ToolCall};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Event<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    timestamp: Option<String>,
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
            "user.message" => {
                state.detail.user_messages += 1;
                if let Some(content) = ev.data.get("content").and_then(|v| v.as_str()) {
                    let id = ev
                        .data
                        .get("interactionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("p{}", state.detail.prompts.len()));
                    if !state.detail.prompts.iter().any(|p| p.id == id) {
                        let snippet: String = content.chars().take(120).collect();
                        let timestamp = ev
                            .timestamp
                            .as_deref()
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt.with_timezone(&chrono::Utc));
                        state.detail.prompts.push(pawscope_core::PromptSummary {
                            id,
                            timestamp,
                            snippet,
                            text: content.to_string(),
                        });
                    }
                }
            }
            "assistant.message" => state.detail.assistant_messages += 1,
            "assistant.turn_end" => state.detail.turns += 1,
            "tool.execution_start" => {
                if let Some(name) = ev.data.get("toolName").and_then(|v| v.as_str()) {
                    *state.detail.tools_used.entry(name.to_string()).or_default() += 1;
                    if let Some(ts) = ev
                        .timestamp
                        .as_deref()
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    {
                        state.detail.tool_calls.push(ToolCall {
                            name: name.to_string(),
                            timestamp: ts.with_timezone(&chrono::Utc),
                        });
                    }
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
            "session.shutdown" => {
                // On shutdown Copilot writes a final tally per-model under
                // data.modelMetrics.<model>.usage.{inputTokens,outputTokens}.
                // Sum across models so cross-model sessions are correct.
                if let Some(metrics) = ev.data.get("modelMetrics").and_then(|v| v.as_object()) {
                    let (mut tin, mut tout) = (0u64, 0u64);
                    for (_model, entry) in metrics {
                        let usage = entry.get("usage");
                        if let Some(u) = usage {
                            tin += u.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            tout += u.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        }
                    }
                    if tin > 0 || tout > 0 {
                        state.detail.tokens_in = tin;
                        state.detail.tokens_out = tout;
                    }
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

    #[test]
    fn extracts_tokens_from_session_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("events.jsonl");
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(
            f,
            r#"{{"type":"session.shutdown","data":{{"modelMetrics":{{"gpt-5":{{"usage":{{"inputTokens":1000,"outputTokens":200}}}},"claude-opus":{{"usage":{{"inputTokens":500,"outputTokens":100}}}}}}}}}}"#
        )
        .unwrap();
        let mut s = ParseState::default();
        parse_incremental(&p, &mut s).unwrap();
        assert_eq!(s.detail.tokens_in, 1500);
        assert_eq!(s.detail.tokens_out, 300);
    }
}
