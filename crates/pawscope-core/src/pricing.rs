//! Static USD pricing table for major LLM providers.
//!
//! Rates are per **1M tokens**. Numbers are best-effort, manually maintained,
//! and reflect public list prices at the time the table was last updated.
//! They are intended for in-dashboard cost estimates — never for billing.
//!
//! ## Cache pricing (Anthropic)
//!
//! Anthropic's prompt-cache feature has separate rates for *write* (creating
//! a cached prefix) and *read* (reusing one). We model these as multipliers
//! over the model's input rate:
//!
//! * cache **write**: 1.25× input rate (Anthropic 5-minute cache)
//! * cache **read**:  0.10× input rate
//!
//! OpenAI does not currently surface cache tokens at the user level, so the
//! cache fields stay at zero for those models.
//!
//! ## Adding a model
//!
//! Add an entry in [`MODEL_PRICES`]. Keys must already be normalized by
//! [`normalize_model`] (lower-case, date suffix stripped, version dashes
//! preserved). Unknown models simply yield `None` from [`price_for`] —
//! callers should treat that as "cost unavailable".
use crate::types::TurnUsage;

/// Per-1M-token rates in USD.
#[derive(Debug, Clone, Copy)]
pub struct ModelPrice {
    pub input_per_million: f64,
    pub output_per_million: f64,
    /// Multiplier applied to `input_per_million` for cache-write tokens.
    /// Defaults to `1.25` (Anthropic). Set to `0.0` for providers that
    /// don't bill cache writes.
    pub cache_write_multiplier: f64,
    /// Multiplier applied to `input_per_million` for cache-read tokens.
    pub cache_read_multiplier: f64,
}

const ANTHROPIC_CACHE_WRITE: f64 = 1.25;
const ANTHROPIC_CACHE_READ: f64 = 0.10;

/// Look up the price record for a *normalized* model name.
pub fn price_for(normalized_model: &str) -> Option<ModelPrice> {
    // Listing as a match instead of a HashMap keeps this `const`-friendly
    // and the table compact for review.
    Some(match normalized_model {
        // Anthropic Claude
        "claude-opus-4-5" | "claude-opus-4" | "claude-opus-4-1" => ModelPrice {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cache_write_multiplier: ANTHROPIC_CACHE_WRITE,
            cache_read_multiplier: ANTHROPIC_CACHE_READ,
        },
        "claude-sonnet-4-5" | "claude-sonnet-4" | "claude-3-7-sonnet"
        | "claude-3-5-sonnet" => ModelPrice {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_write_multiplier: ANTHROPIC_CACHE_WRITE,
            cache_read_multiplier: ANTHROPIC_CACHE_READ,
        },
        "claude-haiku-4-5" | "claude-3-5-haiku" => ModelPrice {
            input_per_million: 1.0,
            output_per_million: 5.0,
            cache_write_multiplier: ANTHROPIC_CACHE_WRITE,
            cache_read_multiplier: ANTHROPIC_CACHE_READ,
        },
        "claude-3-haiku" => ModelPrice {
            input_per_million: 0.25,
            output_per_million: 1.25,
            cache_write_multiplier: ANTHROPIC_CACHE_WRITE,
            cache_read_multiplier: ANTHROPIC_CACHE_READ,
        },

        // OpenAI (Codex / GPT)
        "gpt-5" | "gpt-5-codex" => ModelPrice {
            input_per_million: 1.25,
            output_per_million: 10.0,
            cache_write_multiplier: 0.0,
            cache_read_multiplier: 0.10,
        },
        "gpt-5-mini" => ModelPrice {
            input_per_million: 0.25,
            output_per_million: 2.0,
            cache_write_multiplier: 0.0,
            cache_read_multiplier: 0.10,
        },
        "gpt-4-1" => ModelPrice {
            input_per_million: 2.0,
            output_per_million: 8.0,
            cache_write_multiplier: 0.0,
            cache_read_multiplier: 0.25,
        },
        "gpt-4o" => ModelPrice {
            input_per_million: 2.5,
            output_per_million: 10.0,
            cache_write_multiplier: 0.0,
            cache_read_multiplier: 0.50,
        },
        "gpt-4o-mini" => ModelPrice {
            input_per_million: 0.15,
            output_per_million: 0.60,
            cache_write_multiplier: 0.0,
            cache_read_multiplier: 0.50,
        },

        _ => return None,
    })
}

/// Normalize a model identifier so it can be looked up in [`price_for`].
///
/// Rules:
/// * lower-case
/// * strip trailing `-YYYYMMDD` date suffix (e.g.
///   `claude-sonnet-4-5-20250929` → `claude-sonnet-4-5`)
/// * strip trailing `-latest`
/// * leave dashes between version segments intact
pub fn normalize_model(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    let stripped = lower.strip_suffix("-latest").unwrap_or(&lower);
    // Strip a trailing 8-digit date suffix.
    if let Some((head, tail)) = stripped.rsplit_once('-') {
        if tail.len() == 8 && tail.chars().all(|c| c.is_ascii_digit()) {
            return head.to_string();
        }
    }
    stripped.to_string()
}

/// Compute USD cost for a single [`TurnUsage`]. Returns `None` if the
/// model is not in the pricing table.
pub fn compute_cost(usage: &TurnUsage) -> Option<f64> {
    let price = price_for(&normalize_model(&usage.model))?;
    let inp = usage.input_tokens.unwrap_or(0) as f64;
    let outp = usage.output_tokens.unwrap_or(0) as f64;
    let cread = usage.cache_read_tokens.unwrap_or(0) as f64;
    let cwrite = usage.cache_write_tokens.unwrap_or(0) as f64;

    let cost = inp * price.input_per_million / 1_000_000.0
        + outp * price.output_per_million / 1_000_000.0
        + cread * price.input_per_million * price.cache_read_multiplier / 1_000_000.0
        + cwrite * price.input_per_million * price.cache_write_multiplier / 1_000_000.0;
    Some(cost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_date_suffix() {
        assert_eq!(normalize_model("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5");
        assert_eq!(normalize_model("Claude-Opus-4-1"), "claude-opus-4-1");
        assert_eq!(normalize_model("gpt-5-latest"), "gpt-5");
        assert_eq!(normalize_model("gpt-5-codex"), "gpt-5-codex");
    }

    #[test]
    fn cost_includes_cache_components() {
        let usage = TurnUsage {
            model: "claude-sonnet-4-5".into(),
            input_tokens: Some(1_000_000),
            output_tokens: Some(1_000_000),
            cache_read_tokens: Some(1_000_000),
            cache_write_tokens: Some(1_000_000),
            cost_usd: None,
        };
        let c = compute_cost(&usage).unwrap();
        // 3 input + 15 output + 0.30 cache-read (3 * 0.10) + 3.75 cache-write (3 * 1.25) = 22.05
        assert!((c - 22.05).abs() < 1e-6, "got {c}");
    }

    #[test]
    fn unknown_model_yields_none() {
        let usage = TurnUsage {
            model: "fake-model-9000".into(),
            input_tokens: Some(100),
            output_tokens: Some(100),
            ..Default::default()
        };
        assert!(compute_cost(&usage).is_none());
    }

    #[test]
    fn date_suffix_match_resolves_dated_claude() {
        let usage = TurnUsage {
            model: "claude-sonnet-4-5-20250929".into(),
            input_tokens: Some(1_000_000),
            output_tokens: Some(0),
            ..Default::default()
        };
        let c = compute_cost(&usage).unwrap();
        assert!((c - 3.0).abs() < 1e-6, "got {c}");
    }
}
