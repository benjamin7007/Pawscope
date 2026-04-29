pub mod adapter;
pub mod error;
pub mod pricing;
pub mod types;
pub use adapter::*;
pub use error::*;
pub use types::*;

/// Recompute [`types::TokenSummary`] from the per-turn `usage` fields in a
/// [`types::ConversationLog`]. Adapters call this at the end of their
/// parse cycle (and on each WebSocket-pushed mutation) so the FE always
/// sees a consistent rollup.
///
/// Walks every assistant turn (including subagent-nested turns) and sums
/// tokens + costs grouped by *normalized* model name.
pub fn recompute_token_summary(log: &mut types::ConversationLog) {
    use types::{ModelUsage, TokenSummary, TurnItem, TurnUsage};

    fn walk_turns<'a>(items: &'a [TurnItem], out: &mut Vec<&'a TurnUsage>) {
        for item in items {
            if let TurnItem::Subagent(scope) = item {
                walk_turns(&scope.items, out);
            }
        }
    }

    let mut summary = TokenSummary::default();
    let mut total_cost: f64 = 0.0;
    let mut have_any_cost = false;

    for interaction in &log.interactions {
        for turn in &interaction.turns {
            // Subagent-nested usage isn't currently emitted by adapters, but
            // walk anyway so future additions don't silently miss totals.
            let mut nested: Vec<&TurnUsage> = Vec::new();
            walk_turns(&turn.items, &mut nested);

            let candidates = turn.usage.iter().chain(nested);
            for usage in candidates {
                summary.turn_count += 1;
                summary.total_input_tokens += usage.input_tokens.unwrap_or(0);
                summary.total_output_tokens += usage.output_tokens.unwrap_or(0);
                summary.total_cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
                summary.total_cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);

                let normalized = pricing::normalize_model(&usage.model);
                let known = pricing::price_for(&normalized).is_some();
                if known {
                    summary.turns_with_known_model += 1;
                }

                let entry = summary.by_model.entry(normalized).or_insert_with(ModelUsage::default);
                entry.input_tokens += usage.input_tokens.unwrap_or(0);
                entry.output_tokens += usage.output_tokens.unwrap_or(0);
                entry.cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
                entry.cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
                entry.turn_count += 1;
                if let Some(c) = usage.cost_usd {
                    entry.cost_usd = Some(entry.cost_usd.unwrap_or(0.0) + c);
                    total_cost += c;
                    have_any_cost = true;
                }
            }
        }
    }

    summary.total_cost_usd = if have_any_cost { Some(total_cost) } else { None };
    log.tokens = if summary.turn_count == 0 { None } else { Some(summary) };
}

#[cfg(test)]
mod rollup_tests {
    use super::*;
    use chrono::Utc;
    use types::{AssistantTurn, ConversationLog, Interaction, TurnUsage, UserMessageKind};

    fn turn_with(model: &str, inp: u64, outp: u64) -> AssistantTurn {
        let mut t = AssistantTurn {
            turn_id: "t".into(),
            started_at: Utc::now(),
            completed_at: None,
            items: vec![],
            usage: Some(TurnUsage {
                model: model.into(),
                input_tokens: Some(inp),
                output_tokens: Some(outp),
                ..Default::default()
            }),
        };
        if let Some(u) = t.usage.as_mut() {
            u.cost_usd = pricing::compute_cost(u);
        }
        t
    }

    #[test]
    fn rollup_groups_by_normalized_model() {
        let mut log = ConversationLog {
            interactions: vec![Interaction {
                interaction_id: "i".into(),
                started_at: Utc::now(),
                kind: UserMessageKind::Human,
                user_message_raw: None,
                user_message_transformed: None,
                turns: vec![
                    turn_with("claude-sonnet-4-5-20250929", 1000, 500),
                    turn_with("claude-sonnet-4-5", 2000, 1000),
                    turn_with("gpt-5-codex", 5000, 2000),
                ],
            }],
            ..Default::default()
        };
        recompute_token_summary(&mut log);
        let s = log.tokens.unwrap();
        assert_eq!(s.turn_count, 3);
        assert_eq!(s.turns_with_known_model, 3);
        assert_eq!(s.total_input_tokens, 8000);
        assert_eq!(s.by_model.len(), 2);
        let sonnet = s.by_model.get("claude-sonnet-4-5").unwrap();
        assert_eq!(sonnet.turn_count, 2);
        assert_eq!(sonnet.input_tokens, 3000);
        assert!(s.total_cost_usd.unwrap() > 0.0);
    }

    #[test]
    fn rollup_yields_none_for_empty_log() {
        let mut log = ConversationLog::default();
        recompute_token_summary(&mut log);
        assert!(log.tokens.is_none());
    }
}

