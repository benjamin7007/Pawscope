use crate::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::Timelike;
use pawscope_core::{AgentKind, SessionStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct ListSessionsQuery {
    #[serde(default)]
    pub show_hidden: Option<bool>,
}

pub async fn list_sessions(
    Query(q): Query<ListSessionsQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    match s.adapter.list_sessions().await {
        Ok(v) => {
            if q.show_hidden.unwrap_or(false) {
                Json(v).into_response()
            } else {
                let hidden = s.hidden.snapshot().await;
                let filtered: Vec<_> = v.into_iter().filter(|m| !hidden.contains(&m.id)).collect();
                Json(filtered).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_detail(Path(id): Path<String>, State(s): State<AppState>) -> impl IntoResponse {
    match s.adapter.get_detail(&id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
pub struct ConversationQuery {
    /// If provided, the server may omit interactions/turns at or below this
    /// version when sending deltas. v1 always returns the full log;
    /// `since_version` is reserved for future delta optimisations.
    #[serde(default)]
    pub since_version: Option<u64>,
}

pub async fn get_conversation(
    Path(id): Path<String>,
    Query(_q): Query<ConversationQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    match s.adapter.get_conversation(&id).await {
        Ok(Some(c)) => Json(c).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            "conversation log not available for this adapter",
        )
            .into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
}

pub async fn sessions_tokens(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let tasks: Vec<_> = sessions
        .iter()
        .map(|m| {
            let adapter = s.adapter.clone();
            let id = m.id.clone();
            async move { (id.clone(), adapter.get_detail(&id).await.ok()) }
        })
        .collect();
    let results = futures::future::join_all(tasks).await;
    let mut map = serde_json::Map::new();
    for (id, d) in results {
        if let Some(d) = d {
            if d.tokens_in > 0 || d.tokens_out > 0 {
                map.insert(
                    id,
                    serde_json::json!({"in": d.tokens_in, "out": d.tokens_out}),
                );
            }
        }
    }
    Json(serde_json::Value::Object(map)).into_response()
}

pub async fn activity(State(s): State<AppState>) -> impl IntoResponse {
    match s.adapter.activity_hourly(24).await {
        Ok(b) => Json(serde_json::json!({ "hours": 24, "buckets": b })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn activity_grid(State(s): State<AppState>) -> impl IntoResponse {
    match s.adapter.activity_grid_7x24().await {
        Ok(g) => Json(serde_json::json!({ "rows": 7, "cols": 24, "grid": g })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn overview(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let total = sessions.len();
    let active = sessions
        .iter()
        .filter(|s| s.status == SessionStatus::Active)
        .count();
    let mut by_agent: HashMap<String, usize> = HashMap::new();
    let mut by_repo: HashMap<String, usize> = HashMap::new();
    for s in &sessions {
        let agent_key = serde_json::to_value(s.agent)
            .ok()
            .and_then(|v| v.as_str().map(|x| x.to_string()))
            .unwrap_or_else(|| format!("{:?}", s.agent).to_lowercase());
        *by_agent.entry(agent_key).or_default() += 1;
        if let Some(r) = &s.repo {
            *by_repo.entry(r.clone()).or_default() += 1;
        }
    }

    let mut total_turns: u64 = 0;
    let mut total_user_msgs: u64 = 0;
    let mut total_assistant_msgs: u64 = 0;
    let mut total_tokens_in: u64 = 0;
    let mut total_tokens_out: u64 = 0;
    let mut tokens_by_agent: HashMap<String, (u64, u64)> = HashMap::new();
    let mut tools_used: HashMap<String, u64> = HashMap::new();
    let mut skills_invoked: HashMap<String, u64> = HashMap::new();
    let mut subagents: Vec<serde_json::Value> = Vec::new();
    let mut subagent_count: u64 = 0;
    let mut subagent_active: u64 = 0;

    #[derive(Default)]
    struct Realm {
        sessions: u64,
        turns: u64,
        tool_calls: u64,
        active: u64,
        sessions_this_week: u64,
        sessions_prev_week: u64,
        turns_this_week: u64,
        turns_prev_week: u64,
        daily14: [u64; 14],
        last_event_at: Option<chrono::DateTime<chrono::Utc>>,
        agents: std::collections::BTreeSet<String>,
    }
    let mut realms: HashMap<String, Realm> = HashMap::new();
    let mut sess_realm_key: HashMap<String, String> = HashMap::new();
    let now = chrono::Utc::now();
    let this_week_start = now - chrono::Duration::days(7);
    let prev_week_start = now - chrono::Duration::days(14);

    for sess in &sessions {
        let key = sess.repo.clone().unwrap_or_else(|| {
            sess.cwd
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| format!("~/{}", s))
                .unwrap_or_else(|| sess.cwd.display().to_string())
        });
        sess_realm_key.insert(sess.id.clone(), key.clone());
        let r = realms.entry(key).or_default();
        r.sessions += 1;
        if sess.status == SessionStatus::Active {
            r.active += 1;
        }
        if sess.last_event_at >= this_week_start {
            r.sessions_this_week += 1;
        } else if sess.last_event_at >= prev_week_start {
            r.sessions_prev_week += 1;
        }
        let agent_key = serde_json::to_value(sess.agent)
            .ok()
            .and_then(|v| v.as_str().map(|x| x.to_string()))
            .unwrap_or_else(|| format!("{:?}", sess.agent).to_lowercase());
        r.agents.insert(agent_key);
        r.last_event_at = Some(match r.last_event_at {
            Some(t) if t > sess.last_event_at => t,
            _ => sess.last_event_at,
        });
    }

    // Map session_id → agent label so we can break tokens down per agent.
    let mut sess_agent_key: HashMap<String, String> = HashMap::new();
    let mut sess_last_event: HashMap<String, chrono::DateTime<chrono::Utc>> = HashMap::new();
    for sess in &sessions {
        let agent_key = serde_json::to_value(sess.agent)
            .ok()
            .and_then(|v| v.as_str().map(|x| x.to_string()))
            .unwrap_or_else(|| format!("{:?}", sess.agent).to_lowercase());
        sess_agent_key.insert(sess.id.clone(), agent_key);
        sess_last_event.insert(sess.id.clone(), sess.last_event_at);
    }

    // Daily token buckets for the last 7 days, keyed by session.last_event_at.
    // Index 0 = 6 days ago; index 6 = today (in local Utc).
    let mut tokens_daily7_in: [u64; 7] = [0; 7];
    let mut tokens_daily7_out: [u64; 7] = [0; 7];
    let mut tokens_daily30_in: [u64; 30] = [0; 30];
    let mut tokens_daily30_out: [u64; 30] = [0; 30];
    let today_utc = chrono::Utc::now().date_naive();

    let mut handles = Vec::with_capacity(sessions.len());
    for sess in &sessions {
        let adapter = s.adapter.clone();
        let id = sess.id.clone();
        handles.push(tokio::spawn(async move {
            let detail = adapter.get_detail(&id).await;
            let activity = adapter.session_activity_hourly(&id, 336).await.ok();
            (id, detail, activity)
        }));
    }
    for h in handles {
        if let Ok((sid, Ok(d), activity)) = h.await {
            total_turns += d.turns as u64;
            total_user_msgs += d.user_messages as u64;
            total_assistant_msgs += d.assistant_messages as u64;
            total_tokens_in += d.tokens_in;
            total_tokens_out += d.tokens_out;
            if let Some(agent_key) = sess_agent_key.get(&sid) {
                let entry = tokens_by_agent.entry(agent_key.clone()).or_insert((0, 0));
                entry.0 += d.tokens_in;
                entry.1 += d.tokens_out;
            }
            // Bucket session token totals into the 7-day window by last_event_at.
            if d.tokens_in > 0 || d.tokens_out > 0 {
                if let Some(t) = sess_last_event.get(&sid) {
                    let days_ago = (today_utc - t.date_naive()).num_days();
                    if (0..7).contains(&days_ago) {
                        let idx = (6 - days_ago) as usize;
                        tokens_daily7_in[idx] += d.tokens_in;
                        tokens_daily7_out[idx] += d.tokens_out;
                    }
                    if (0..30).contains(&days_ago) {
                        let idx = (29 - days_ago) as usize;
                        tokens_daily30_in[idx] += d.tokens_in;
                        tokens_daily30_out[idx] += d.tokens_out;
                    }
                }
            }
            let session_tools: u64 = d.tools_used.values().map(|&v| v as u64).sum();
            if let Some(key) = sess_realm_key.get(&sid) {
                if let Some(r) = realms.get_mut(key) {
                    r.turns += d.turns as u64;
                    r.tool_calls += session_tools;
                    if let Some(buckets) = &activity {
                        if buckets.len() >= 336 {
                            let prev: u64 = buckets[0..168].iter().sum();
                            let this: u64 = buckets[168..336].iter().sum();
                            r.turns_this_week += this;
                            r.turns_prev_week += prev;
                            for d in 0..14 {
                                let mut s = 0u64;
                                for h in 0..24 {
                                    s += buckets[d * 24 + h];
                                }
                                r.daily14[d] += s;
                            }
                        }
                    }
                }
            }
            for (k, v) in d.tools_used {
                *tools_used.entry(k).or_default() += v as u64;
            }
            for k in d.skills_invoked {
                *skills_invoked.entry(k).or_default() += 1;
            }
            for sa in d.subagents {
                subagent_count += 1;
                if sa.active {
                    subagent_active += 1;
                }
                subagents.push(serde_json::json!({
                    "session_id": sid,
                    "id": sa.id,
                    "turns": sa.turns,
                    "tool_calls": sa.tool_calls,
                    "agent_type": sa.agent_type,
                    "description": sa.description,
                    "started_at": sa.started_at,
                    "ended_at": sa.ended_at,
                    "active": sa.active,
                }));
            }
        }
    }

    let mut realm_list: Vec<_> = realms
        .into_iter()
        .map(|(name, r)| {
            serde_json::json!({
                "name": name,
                "sessions": r.sessions,
                "active": r.active,
                "turns": r.turns,
                "tool_calls": r.tool_calls,
                "sessions_this_week": r.sessions_this_week,
                "sessions_prev_week": r.sessions_prev_week,
                "turns_this_week": r.turns_this_week,
                "turns_prev_week": r.turns_prev_week,
                "daily14": r.daily14,
                "last_event_at": r.last_event_at,
                "agents": r.agents.into_iter().collect::<Vec<_>>(),
            })
        })
        .collect();
    realm_list.sort_by(|a, b| {
        let ta = a.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        let tb = b.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        tb.cmp(&ta).then_with(|| {
            let sa = a.get("sessions").and_then(|x| x.as_u64()).unwrap_or(0);
            let sb = b.get("sessions").and_then(|x| x.as_u64()).unwrap_or(0);
            sb.cmp(&sa)
        })
    });
    let top_realms: Vec<_> = realm_list.into_iter().take(10).collect();

    subagents.sort_by(|a, b| {
        let ta = a.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        let tb = b.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        tb.cmp(&ta)
    });
    let top_subagents: Vec<_> = subagents.into_iter().take(10).collect();

    let tokens_by_agent_json: serde_json::Value = tokens_by_agent
        .iter()
        .map(|(k, (i, o))| (k.clone(), serde_json::json!({"in": i, "out": o})))
        .collect::<serde_json::Map<_, _>>()
        .into();

    Json(serde_json::json!({
        "total_sessions": total,
        "active_sessions": active,
        "by_agent": by_agent,
        "by_repo": by_repo,
        "total_turns": total_turns,
        "total_user_messages": total_user_msgs,
        "total_assistant_messages": total_assistant_msgs,
        "total_tokens_in": total_tokens_in,
        "total_tokens_out": total_tokens_out,
        "tokens_by_agent": tokens_by_agent_json,
        "tokens_daily7_in": tokens_daily7_in,
        "tokens_daily7_out": tokens_daily7_out,
        "tokens_daily30_in": tokens_daily30_in,
        "tokens_daily30_out": tokens_daily30_out,
        "tools_used": tools_used,
        "skills_invoked": skills_invoked,
        "subagent_count": subagent_count,
        "subagent_active": subagent_active,
        "top_subagents": top_subagents,
        "top_realms": top_realms,
    }))
    .into_response()
}

#[derive(serde::Deserialize)]
pub struct RealmQuery {
    pub name: String,
}

pub async fn realm_detail(
    axum::extract::Query(q): axum::extract::Query<RealmQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    use std::collections::BTreeMap;
    let target = q.name;
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let realm_key = |sess: &pawscope_core::SessionMeta| -> String {
        sess.repo.clone().unwrap_or_else(|| {
            sess.cwd
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| format!("~/{}", s))
                .unwrap_or_else(|| sess.cwd.display().to_string())
        })
    };

    let in_realm: Vec<_> = sessions
        .iter()
        .filter(|s| realm_key(s) == target)
        .cloned()
        .collect();
    if in_realm.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            format!("realm not found: {}", target),
        )
            .into_response();
    }

    let mut total_turns: u64 = 0;
    let mut total_tools: u64 = 0;
    let mut tools_used: HashMap<String, u64> = HashMap::new();
    let mut skills_invoked: HashMap<String, u64> = HashMap::new();
    let mut activity_336 = vec![0u64; 336];
    let mut subagents: Vec<serde_json::Value> = Vec::new();
    let mut session_summaries: Vec<serde_json::Value> = Vec::new();

    let mut handles = Vec::new();
    for sess in &in_realm {
        let adapter = s.adapter.clone();
        let id = sess.id.clone();
        handles.push(tokio::spawn(async move {
            let detail = adapter.get_detail(&id).await;
            let activity = adapter.session_activity_hourly(&id, 336).await.ok();
            (id, detail, activity)
        }));
    }
    let mut detail_map: BTreeMap<String, pawscope_core::SessionDetail> = BTreeMap::new();
    let mut activity_map: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    for h in handles {
        if let Ok((sid, Ok(d), act)) = h.await {
            if let Some(buckets) = &act {
                if buckets.len() == 336 {
                    for (i, v) in buckets.iter().enumerate() {
                        activity_336[i] += v;
                    }
                }
            }
            total_turns += d.turns as u64;
            for (k, v) in &d.tools_used {
                *tools_used.entry(k.clone()).or_default() += *v as u64;
                total_tools += *v as u64;
            }
            for k in &d.skills_invoked {
                *skills_invoked.entry(k.clone()).or_default() += 1;
            }
            for sa in &d.subagents {
                subagents.push(serde_json::json!({
                    "session_id": sid,
                    "id": sa.id,
                    "turns": sa.turns,
                    "tool_calls": sa.tool_calls,
                    "agent_type": sa.agent_type,
                    "description": sa.description,
                    "active": sa.active,
                }));
            }
            detail_map.insert(sid.clone(), d);
            if let Some(a) = act {
                activity_map.insert(sid, a);
            }
        }
    }

    for sess in &in_realm {
        let d = detail_map.get(&sess.id);
        session_summaries.push(serde_json::json!({
            "id": sess.id,
            "agent": sess.agent,
            "summary": sess.summary,
            "branch": sess.branch,
            "status": sess.status,
            "model": sess.model,
            "started_at": sess.started_at,
            "last_event_at": sess.last_event_at,
            "turns": d.map(|x| x.turns).unwrap_or(0),
            "tool_calls": d.map(|x| x.tools_used.values().map(|&v| v as u64).sum::<u64>()).unwrap_or(0),
        }));
    }

    let mut tools_sorted: Vec<_> = tools_used.into_iter().collect();
    tools_sorted.sort_by(|a, b| b.1.cmp(&a.1));
    let mut skills_sorted: Vec<_> = skills_invoked.into_iter().collect();
    skills_sorted.sort_by(|a, b| b.1.cmp(&a.1));
    subagents.sort_by(|a, b| {
        let ta = a.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        let tb = b.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
        tb.cmp(&ta)
    });

    let agents: std::collections::BTreeSet<_> = in_realm
        .iter()
        .map(|s| {
            serde_json::to_value(s.agent)
                .ok()
                .and_then(|v| v.as_str().map(|x| x.to_string()))
                .unwrap_or_default()
        })
        .collect();

    Json(serde_json::json!({
        "name": target,
        "agents": agents.into_iter().collect::<Vec<_>>(),
        "total_sessions": in_realm.len(),
        "total_turns": total_turns,
        "total_tool_calls": total_tools,
        "tools_used": tools_sorted.into_iter().take(15).collect::<Vec<_>>(),
        "skills_invoked": skills_sorted.into_iter().collect::<Vec<_>>(),
        "subagents": subagents.into_iter().take(10).collect::<Vec<_>>(),
        "activity_336h": activity_336,
        "sessions": session_summaries,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct PromptSearchQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    /// Lower bound on prompt timestamp (RFC3339).
    #[serde(default)]
    pub since: Option<String>,
    /// Upper bound on prompt timestamp (RFC3339).
    #[serde(default)]
    pub until: Option<String>,
}

#[derive(Debug, Serialize)]
struct PromptHit {
    session_id: String,
    agent: pawscope_core::AgentKind,
    cwd: String,
    repo: Option<String>,
    branch: Option<String>,
    summary: String,
    prompt_id: String,
    timestamp: Option<chrono::DateTime<chrono::Utc>>,
    snippet: String,
    text: String,
}

pub async fn prompts_search(
    Query(p): Query<PromptSearchQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let q_raw = p.q.unwrap_or_default();
    let q = q_raw.trim();
    if q.len() > 200 {
        return (StatusCode::BAD_REQUEST, "q too long").into_response();
    }
    let limit = p.limit.unwrap_or(50).min(200);
    let needle = q.to_lowercase();
    let agent_filter = p.agent.as_deref().map(str::to_lowercase);
    let repo_filter = p.repo.as_deref().map(|s| s.to_lowercase());
    let since = p
        .since
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));
    let until = p
        .until
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    let mut sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    // Pre-filter at session level (agent / repo) to skip detail fetch.
    sessions.retain(|sess| {
        if let Some(af) = &agent_filter {
            let ak = serde_json::to_value(sess.agent)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            if &ak != af {
                return false;
            }
        }
        if let Some(rf) = &repo_filter {
            let r = sess.repo.as_deref().unwrap_or("").to_lowercase();
            if !r.contains(rf) {
                return false;
            }
        }
        true
    });

    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut hits: Vec<PromptHit> = Vec::new();
    for (sess, detail) in pairs {
        for prompt in &detail.prompts {
            if let Some(t) = prompt.timestamp {
                if let Some(s) = since {
                    if t < s {
                        continue;
                    }
                }
                if let Some(u) = until {
                    if t > u {
                        continue;
                    }
                }
            }
            let hay_snip = prompt.snippet.to_lowercase();
            let hay_text = prompt.text.to_lowercase();
            if !needle.is_empty() && !hay_snip.contains(&needle) && !hay_text.contains(&needle) {
                continue;
            }
            hits.push(PromptHit {
                session_id: sess.id.clone(),
                agent: sess.agent,
                cwd: sess.cwd.to_string_lossy().to_string(),
                repo: sess.repo.clone(),
                branch: sess.branch.clone(),
                summary: sess.summary.clone(),
                prompt_id: prompt.id.clone(),
                timestamp: prompt.timestamp,
                snippet: prompt.snippet.clone(),
                text: {
                    let max = 16 * 1024;
                    if prompt.text.len() <= max {
                        prompt.text.clone()
                    } else {
                        let mut s = prompt.text[..max].to_string();
                        s.push_str("\n…[truncated]");
                        s
                    }
                },
            });
        }
    }
    hits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    hits.truncate(limit);
    Json(hits).into_response()
}

#[derive(Debug, Serialize)]
struct PromptLenStats {
    total: u64,
    mean: f64,
    median: u64,
    p95: u64,
    p99: u64,
    max: u64,
    buckets: Vec<PromptLenBucket>,
}

#[derive(Debug, Serialize)]
struct PromptLenBucket {
    label: String,
    min: u64,
    max: u64,
    count: u64,
}

pub async fn prompts_length(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut lens: Vec<u64> = Vec::new();
    for (_, detail) in pairs {
        for prompt in &detail.prompts {
            lens.push(prompt.text.chars().count() as u64);
        }
    }
    if lens.is_empty() {
        return Json(PromptLenStats {
            total: 0,
            mean: 0.0,
            median: 0,
            p95: 0,
            p99: 0,
            max: 0,
            buckets: vec![],
        })
        .into_response();
    }
    lens.sort_unstable();
    let total = lens.len() as u64;
    let sum: u64 = lens.iter().sum();
    let mean = sum as f64 / total as f64;
    let pct = |p: f64| -> u64 {
        let idx = ((lens.len() as f64 - 1.0) * p).round() as usize;
        lens[idx]
    };
    let median = pct(0.5);
    let p95 = pct(0.95);
    let p99 = pct(0.99);
    let max_v = *lens.last().unwrap();
    let edges: &[(&str, u64, u64)] = &[
        ("<50", 0, 50),
        ("50-100", 50, 100),
        ("100-200", 100, 200),
        ("200-500", 200, 500),
        ("500-1k", 500, 1_000),
        ("1k-2k", 1_000, 2_000),
        ("2k-5k", 2_000, 5_000),
        ("5k-10k", 5_000, 10_000),
        ("10k+", 10_000, u64::MAX),
    ];
    let mut buckets: Vec<PromptLenBucket> = edges
        .iter()
        .map(|(l, mn, mx)| PromptLenBucket {
            label: (*l).to_string(),
            min: *mn,
            max: *mx,
            count: 0,
        })
        .collect();
    for &len in &lens {
        for b in buckets.iter_mut() {
            if len >= b.min && len < b.max {
                b.count += 1;
                break;
            }
        }
    }
    Json(PromptLenStats {
        total,
        mean,
        median,
        p95,
        p99,
        max: max_v,
        buckets,
    })
    .into_response()
}

#[derive(Debug, Serialize)]
struct TechEntry {
    key: String,
    label: String,
    icon: String,
    hits: u64,
    sessions: u64,
}

#[derive(Debug, Serialize)]
struct TechStackStats {
    total_sessions: u64,
    sessions_with_tech: u64,
    entries: Vec<TechEntry>,
    per_session: HashMap<String, Vec<String>>,
}

fn tech_patterns() -> &'static [(
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
)] {
    &[
        (
            "rust",
            "Rust",
            "🦀",
            &[
                "rust", "cargo", "rustc", "clippy", "tokio", "serde", "axum", "actix",
            ],
        ),
        (
            "python",
            "Python",
            "🐍",
            &[
                "python", "pip ", "pip3", "django", "flask", "fastapi", "pandas", "numpy",
                "pytorch", ".py",
            ],
        ),
        (
            "typescript",
            "TypeScript",
            "🔷",
            &["typescript", "tsconfig", " tsc ", ".ts", ".tsx"],
        ),
        (
            "javascript",
            "JavaScript",
            "🟨",
            &[
                "javascript",
                "node.js",
                " npm ",
                "yarn",
                "pnpm",
                ".js",
                ".jsx",
            ],
        ),
        (
            "react",
            "React",
            "⚛️",
            &[
                "react",
                "jsx",
                "tsx",
                "useState",
                "useEffect",
                "next.js",
                "vite",
            ],
        ),
        ("vue", "Vue", "💚", &["vue.js", "vuejs", "nuxt"]),
        (
            "go",
            "Go",
            "🐹",
            &["golang", " go ", " go.mod", "goroutine", ".go "],
        ),
        (
            "java",
            "Java",
            "☕",
            &["java ", "maven", "gradle", "spring", "kotlin"],
        ),
        (
            "swift",
            "Swift",
            "🦅",
            &["swift", "swiftui", "xcode", ".swift"],
        ),
        ("ruby", "Ruby", "💎", &["ruby", "rails", "gemfile"]),
        ("php", "PHP", "🐘", &["php ", "laravel", "composer", ".php"]),
        (
            "cpp",
            "C/C++",
            "⚙️",
            &["c++", "cpp", "cmake", " gcc ", " clang "],
        ),
        (
            "csharp",
            "C#",
            "🎯",
            &["c#", "csharp", ".net ", "dotnet", ".cs "],
        ),
        (
            "docker",
            "Docker",
            "🐳",
            &["docker", "dockerfile", "compose.yml", "compose.yaml"],
        ),
        (
            "k8s",
            "Kubernetes",
            "☸️",
            &["kubernetes", "k8s", "kubectl", "helm"],
        ),
        (
            "postgres",
            "Postgres",
            "🐘",
            &["postgres", "postgresql", "psql"],
        ),
        ("mysql", "MySQL", "🐬", &["mysql", "mariadb"]),
        ("sqlite", "SQLite", "📦", &["sqlite", ".db "]),
        ("mongo", "MongoDB", "🍃", &["mongodb", "mongo "]),
        ("redis", "Redis", "🔴", &["redis", "valkey"]),
        (
            "aws",
            "AWS",
            "☁️",
            &["aws ", "amazon web", " s3 ", "ec2", "lambda"],
        ),
        (
            "git",
            "Git",
            "🔧",
            &["git ", "github", "gitlab", "merge request", "pull request"],
        ),
        ("tailwind", "Tailwind", "💨", &["tailwind", "tailwindcss"]),
        ("nginx", "Nginx", "🟢", &["nginx"]),
        ("graphql", "GraphQL", "🔺", &["graphql", "apollo"]),
        ("terraform", "Terraform", "🌍", &["terraform", "hcl"]),
    ]
}

pub async fn techstack(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let total_sessions = sessions.len() as u64;
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let pats = tech_patterns();
    let mut hits: HashMap<&'static str, u64> = HashMap::new();
    let mut sess_count: HashMap<&'static str, u64> = HashMap::new();
    let mut per_session: HashMap<String, Vec<String>> = HashMap::new();
    let mut sessions_with_tech: u64 = 0;
    for (meta, detail) in pairs {
        let mut blob = String::new();
        for p in &detail.prompts {
            blob.push_str(&p.text.to_lowercase());
            blob.push(' ');
        }
        if blob.is_empty() {
            continue;
        }
        let mut local: Vec<&'static str> = Vec::new();
        for (key, _label, _icon, kws) in pats {
            let mut h = 0u64;
            for k in *kws {
                let mut idx = 0;
                while let Some(pos) = blob[idx..].find(k) {
                    h += 1;
                    idx += pos + k.len();
                }
            }
            if h > 0 {
                *hits.entry(*key).or_insert(0) += h;
                local.push(*key);
            }
        }
        if !local.is_empty() {
            sessions_with_tech += 1;
            for k in &local {
                *sess_count.entry(*k).or_insert(0) += 1;
            }
            per_session.insert(
                meta.id.clone(),
                local.iter().map(|s| s.to_string()).collect(),
            );
        }
    }
    let mut entries: Vec<TechEntry> = pats
        .iter()
        .filter_map(|(key, label, icon, _)| {
            let h = *hits.get(key).unwrap_or(&0);
            if h == 0 {
                return None;
            }
            Some(TechEntry {
                key: key.to_string(),
                label: label.to_string(),
                icon: icon.to_string(),
                hits: h,
                sessions: *sess_count.get(key).unwrap_or(&0),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.sessions.cmp(&a.sessions).then(b.hits.cmp(&a.hits)));
    Json(TechStackStats {
        total_sessions,
        sessions_with_tech,
        entries,
        per_session,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct WeeklyQuery {
    #[serde(default)]
    pub weeks: Option<usize>,
}

#[derive(Debug, Serialize)]
struct WeeklySeries {
    label: String,
    days: Vec<u64>,
}

#[derive(Debug, Serialize)]
struct WeeklyTrend {
    weeks: Vec<WeeklySeries>,
    total_this_week: u64,
    total_last_week: u64,
    delta_pct: f64,
}

pub async fn activity_weekly(
    State(s): State<AppState>,
    Query(q): Query<WeeklyQuery>,
) -> impl IntoResponse {
    use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
    let n = q.weeks.unwrap_or(2).clamp(2, 8);
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut events: Vec<NaiveDate> = Vec::new();
    for (_, d) in pairs {
        for p in &d.prompts {
            if let Some(t) = p.timestamp {
                events.push(t.with_timezone(&Local).date_naive());
            }
        }
    }
    let today = Local::now().date_naive();
    let days_from_mon = today.weekday().num_days_from_monday() as i64;
    let this_monday = today - Duration::days(days_from_mon);
    let mut weeks: Vec<WeeklySeries> = Vec::new();
    let mut totals: Vec<u64> = Vec::new();
    for w in 0..n {
        let start = this_monday - Duration::weeks(w as i64);
        let mut days = vec![0u64; 7];
        for ev in &events {
            let diff = (*ev - start).num_days();
            if (0..7).contains(&diff) {
                days[diff as usize] += 1;
            }
        }
        let label = if w == 0 {
            "this".to_string()
        } else if w == 1 {
            "last".to_string()
        } else {
            format!("-{}w", w)
        };
        let total: u64 = days.iter().sum();
        totals.push(total);
        weeks.push(WeeklySeries { label, days });
        let _ = Weekday::Mon;
    }
    let total_this = *totals.first().unwrap_or(&0);
    let total_last = *totals.get(1).unwrap_or(&0);
    let delta_pct = if total_last > 0 {
        ((total_this as f64 - total_last as f64) / total_last as f64) * 100.0
    } else if total_this > 0 {
        100.0
    } else {
        0.0
    };
    Json(WeeklyTrend {
        weeks,
        total_this_week: total_this,
        total_last_week: total_last,
        delta_pct,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct WordcloudQuery {
    #[serde(default)]
    pub top: Option<usize>,
    #[serde(default)]
    pub agent: Option<String>,
}

#[derive(Debug, Serialize)]
struct WordcloudEntry {
    word: String,
    count: u64,
    sessions: u64,
}

pub async fn sessions_pulse(State(s): State<AppState>) -> impl IntoResponse {
    let bins = 20usize;
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut out = serde_json::Map::new();
    for (meta, detail) in pairs {
        let mut times: Vec<i64> = Vec::new();
        for p in &detail.prompts {
            if let Some(ts) = p.timestamp {
                times.push(ts.timestamp_millis());
            }
        }
        for c in &detail.tool_calls {
            times.push(c.timestamp.timestamp_millis());
        }
        if times.len() < 2 {
            continue;
        }
        times.sort_unstable();
        let t0 = *times.first().unwrap();
        let tn = *times.last().unwrap();
        let span = (tn - t0).max(1);
        let mut buckets = vec![0u32; bins];
        for t in &times {
            let idx = (((*t - t0) as f64 / span as f64) * bins as f64).floor() as usize;
            let idx = idx.min(bins - 1);
            buckets[idx] += 1;
        }
        out.insert(
            meta.id,
            serde_json::json!({
                "bins": buckets,
                "events": times.len(),
            }),
        );
    }
    Json(out).into_response()
}

#[derive(Debug, Serialize)]
struct HeartbeatStats {
    grid: Vec<Vec<u64>>,
    days: Vec<String>,
    by_hour: Vec<u64>,
    by_dow: Vec<u64>,
    peak_hour: u32,
    peak_dow: u32,
    total: u64,
}

pub async fn activity_heartbeat(State(s): State<AppState>) -> impl IntoResponse {
    use chrono::{Datelike, Local, Timelike};
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut grid = vec![vec![0u64; 24]; 7];
    let mut by_hour = vec![0u64; 24];
    let mut by_dow = vec![0u64; 7];
    let mut total: u64 = 0;
    for (_, detail) in pairs {
        for p in &detail.prompts {
            if let Some(ts) = p.timestamp {
                let local = ts.with_timezone(&Local);
                let dow = local.weekday().num_days_from_monday() as usize;
                let hour = local.hour() as usize;
                grid[dow][hour] += 1;
                by_hour[hour] += 1;
                by_dow[dow] += 1;
                total += 1;
            }
        }
    }
    let peak_hour = by_hour
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| **c)
        .map(|(i, _)| i as u32)
        .unwrap_or(0);
    let peak_dow = by_dow
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| **c)
        .map(|(i, _)| i as u32)
        .unwrap_or(0);
    Json(HeartbeatStats {
        grid,
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        by_hour,
        by_dow,
        peak_hour,
        peak_dow,
        total,
    })
    .into_response()
}

#[derive(Debug, Serialize)]
struct DangerEntry {
    name: String,
    severity: String,
    count: u64,
    sessions: u64,
    session_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct DangerStats {
    entries: Vec<DangerEntry>,
    total_calls: u64,
    sessions_affected: u64,
}

fn danger_severity(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    let high = [
        "run_in_terminal",
        "execute_command",
        "shell",
        "bash",
        "powershell",
        "delete_file",
        "rm_file",
        "remove_file",
        "delete",
        "drop_table",
        "git_push",
        "force_push",
        "rebase",
    ];
    let medium = [
        "write_file",
        "create_file",
        "edit_file",
        "edit",
        "replace_string_in_file",
        "create",
        "patch",
        "apply_patch",
        "modify",
    ];
    let low = [
        "fetch_webpage",
        "open_url",
        "browser",
        "web_search",
        "curl",
        "http_request",
    ];
    for k in &high {
        if n == *k || n.contains(k) {
            return Some("high");
        }
    }
    for k in &medium {
        if n == *k || n.contains(k) {
            return Some("medium");
        }
    }
    for k in &low {
        if n == *k || n.contains(k) {
            return Some("low");
        }
    }
    None
}

pub async fn tools_dangerous(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut counts: HashMap<String, (u64, std::collections::HashSet<String>, &'static str)> =
        HashMap::new();
    let mut affected: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut total: u64 = 0;
    for (meta, detail) in pairs {
        for c in &detail.tool_calls {
            if let Some(sev) = danger_severity(&c.name) {
                let entry = counts.entry(c.name.clone()).or_insert((
                    0,
                    std::collections::HashSet::new(),
                    sev,
                ));
                entry.0 += 1;
                entry.1.insert(meta.id.clone());
                affected.insert(meta.id.clone());
                total += 1;
            }
        }
    }
    let mut entries: Vec<DangerEntry> = counts
        .into_iter()
        .map(|(name, (count, sess, sev))| {
            let total_sess = sess.len() as u64;
            let mut ids: Vec<String> = sess.into_iter().collect();
            ids.sort();
            ids.truncate(20);
            DangerEntry {
                name,
                severity: sev.to_string(),
                count,
                sessions: total_sess,
                session_ids: ids,
            }
        })
        .collect();
    let sev_rank = |s: &str| -> u8 {
        match s {
            "high" => 0,
            "medium" => 1,
            "low" => 2,
            _ => 3,
        }
    };
    entries.sort_by(|a, b| {
        sev_rank(&a.severity)
            .cmp(&sev_rank(&b.severity))
            .then(b.count.cmp(&a.count))
    });
    Json(DangerStats {
        entries,
        total_calls: total,
        sessions_affected: affected.len() as u64,
    })
    .into_response()
}

#[derive(Debug, Serialize)]
struct HotFileSample {
    session_id: String,
    snippet: String,
}

#[derive(Debug, Serialize)]
struct HotFile {
    path: String,
    mentions: u64,
    sessions: u64,
    #[serde(default)]
    samples: Vec<HotFileSample>,
}

pub async fn files_hot(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let re = match regex::Regex::new(r"(?:[A-Za-z0-9_./\-]+)?[A-Za-z0-9_\-]+\.[A-Za-z0-9]{1,6}\b") {
        Ok(r) => r,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "regex").into_response(),
    };
    let stop_ext: std::collections::HashSet<&str> =
        ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
            .iter()
            .copied()
            .collect();
    let mut counts: HashMap<String, (u64, std::collections::HashSet<String>, Vec<HotFileSample>)> =
        HashMap::new();
    for (meta, detail) in pairs {
        let mut seen_in_session: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for p in &detail.prompts {
            for m in re.find_iter(&p.text) {
                let raw = m.as_str();
                if raw.len() < 4 || raw.len() > 80 {
                    continue;
                }
                let after_dot = raw.rsplit('.').next().unwrap_or("");
                if stop_ext.contains(after_dot) {
                    continue;
                }
                if !after_dot.chars().all(|c| c.is_ascii_alphabetic()) {
                    continue;
                }
                if !raw.chars().any(|c| c == '/' || c == '.') {
                    continue;
                }
                let mut normed = raw
                    .trim_matches(|c: char| c == '.' || c == ',' || c == ')' || c == '(')
                    .to_string();
                if normed.is_empty() {
                    continue;
                }
                // Strip URL schemes and host prefixes: http://example.com/foo.js → foo.js
                if let Some(rest) = normed
                    .strip_prefix("http://")
                    .or_else(|| normed.strip_prefix("https://"))
                {
                    normed = rest.to_string();
                }
                if let Some(rest) = normed.strip_prefix("//") {
                    normed = rest.to_string();
                }
                if let Some(idx) = normed.find('/') {
                    let head = &normed[..idx];
                    if head.contains('.') && head.chars().any(|c| c.is_ascii_alphabetic()) {
                        let tail = &normed[idx + 1..];
                        if !tail.is_empty() {
                            normed = tail.to_string();
                        }
                    }
                }
                // Strip user home prefixes: /Users/<name>/foo.rs → foo.rs, /home/<name>/... → ...
                for prefix in ["/Users/", "/home/", "/root/"] {
                    if let Some(rest) = normed.strip_prefix(prefix) {
                        if let Some(slash) = rest.find('/') {
                            normed = rest[slash + 1..].to_string();
                        } else {
                            // Just /Users/<name> with no further file → skip entirely.
                            normed = String::new();
                        }
                    }
                }
                if normed.is_empty() {
                    continue;
                }
                // Drop pure hostname leftovers (no slash, no real ext like ".com" / ".io")
                if !normed.contains('/') {
                    let ext_after = normed.rsplit('.').next().unwrap_or("");
                    let host_tlds = [
                        "com", "io", "org", "net", "dev", "ai", "co", "app", "xyz", "me",
                    ];
                    if host_tlds.contains(&ext_after) {
                        continue;
                    }
                    // Reject "extensions" that start with uppercase — likely proper nouns (e.g. John.Smith).
                    if ext_after
                        .chars()
                        .next()
                        .map(|c| c.is_ascii_uppercase())
                        .unwrap_or(false)
                    {
                        continue;
                    }
                }
                if normed.is_empty() || normed.len() < 3 {
                    continue;
                }
                let entry = counts
                    .entry(normed.clone())
                    .or_insert_with(|| (0, std::collections::HashSet::new(), Vec::new()));
                entry.0 += 1;
                if !seen_in_session.contains(&normed) {
                    entry.1.insert(meta.id.clone());
                    seen_in_session.insert(normed.clone());
                    // Capture up to 5 sample snippets per file (one per distinct session).
                    if entry.2.len() < 5 {
                        let snippet = make_prompt_snippet(&p.text, raw, 140);
                        entry.2.push(HotFileSample {
                            session_id: meta.id.clone(),
                            snippet,
                        });
                    }
                }
            }
        }
    }
    let mut entries: Vec<HotFile> = counts
        .into_iter()
        .map(|(path, (m, sess, samples))| HotFile {
            path,
            mentions: m,
            sessions: sess.len() as u64,
            samples,
        })
        .collect();
    entries.retain(|e| e.mentions >= 2);
    entries.sort_by(|a, b| {
        b.sessions
            .cmp(&a.sessions)
            .then(b.mentions.cmp(&a.mentions))
    });
    entries.truncate(40);
    Json(entries).into_response()
}

/// Build a short snippet of a prompt centered on `needle`, padded to ~`max_len` chars.
fn make_prompt_snippet(text: &str, needle: &str, max_len: usize) -> String {
    let pos = text.find(needle).unwrap_or(0);
    let half = max_len / 2;
    // Walk backward by chars from `pos` to find a safe start byte.
    let start_byte = text[..pos]
        .char_indices()
        .rev()
        .nth(half)
        .map(|(i, _)| i)
        .unwrap_or(0);
    // Walk forward by chars from end of needle to find a safe end byte.
    let after_needle = pos + needle.len();
    let end_byte = if after_needle >= text.len() {
        text.len()
    } else {
        text[after_needle..]
            .char_indices()
            .nth(half)
            .map(|(i, _)| after_needle + i)
            .unwrap_or(text.len())
    };
    let mut snippet = String::new();
    if start_byte > 0 {
        snippet.push('…');
    }
    snippet.push_str(text[start_byte..end_byte].trim());
    if end_byte < text.len() {
        snippet.push('…');
    }
    snippet.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF |
        0x3040..=0x309F | 0x30A0..=0x30FF | 0xAC00..=0xD7AF)
}

fn stopwords_en() -> &'static std::collections::HashSet<&'static str> {
    use std::sync::OnceLock;
    static SW: OnceLock<std::collections::HashSet<&'static str>> = OnceLock::new();
    SW.get_or_init(|| {
        [
            "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to", "of", "in",
            "on", "at", "by", "is", "are", "was", "were", "be", "been", "being", "do", "does",
            "did", "done", "have", "has", "had", "this", "that", "these", "those", "it", "its",
            "as", "with", "from", "about", "into", "over", "up", "you", "your", "my", "me", "we",
            "us", "our", "they", "them", "their", "i", "he", "she", "his", "her", "can", "could",
            "should", "would", "may", "might", "will", "shall", "just", "not", "no", "yes", "what",
            "which", "who", "when", "where", "why", "how", "there", "here", "than", "also", "very",
            "want", "need", "make", "made", "get", "got", "use", "used", "using", "help", "please",
            "thanks", "all", "any", "some", "one", "two", "three", "more", "most", "much", "many",
            "few", "other", "let", "like", "etc", "via", "per", "each", "both", "only", "own",
            "same", "such", "too", "off", "out", "over", "under", "again", "further", "once",
            "cant", "dont", "wont", "im", "ive", "its",
        ]
        .into_iter()
        .collect()
    })
}

fn stopwords_cjk() -> &'static std::collections::HashSet<&'static str> {
    use std::sync::OnceLock;
    static SW: OnceLock<std::collections::HashSet<&'static str>> = OnceLock::new();
    SW.get_or_init(|| {
        [
            "的",
            "了",
            "和",
            "是",
            "我",
            "你",
            "他",
            "她",
            "它",
            "们",
            "在",
            "有",
            "就",
            "都",
            "也",
            "还",
            "要",
            "一个",
            "什么",
            "怎么",
            "可以",
            "这个",
            "那个",
            "如何",
            "为什么",
            "或者",
            "但是",
            "因为",
            "所以",
            "需要",
            "使用",
            "帮我",
            "请帮",
            "一下",
            "现在",
            "已经",
            "没有",
            "我们",
            "他们",
            "这里",
            "那里",
            "可能",
            "应该",
            "不是",
            "就是",
            "然后",
            "然而",
            "并且",
            "或是",
            "以及",
            "之后",
            "之前",
            "直接",
            "麻烦",
            "谢谢",
            "好的",
            "不要",
            "出来",
            "起来",
            "上去",
            "下去",
            "进去",
            "出去",
            "进来",
        ]
        .into_iter()
        .collect()
    })
}

fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    for ch in text.chars() {
        if is_cjk(ch) {
            if !buf.is_empty() {
                for w in buf.split(|c: char| !c.is_alphanumeric()) {
                    let w = w.trim().to_lowercase();
                    if w.len() >= 3
                        && !w.chars().all(|c| c.is_ascii_digit())
                        && !stopwords_en().contains(w.as_str())
                    {
                        out.push(w);
                    }
                }
                buf.clear();
            }
        } else {
            buf.push(ch);
        }
    }
    if !buf.is_empty() {
        for w in buf.split(|c: char| !c.is_alphanumeric()) {
            let w = w.trim().to_lowercase();
            if w.len() >= 3
                && !w.chars().all(|c| c.is_ascii_digit())
                && !stopwords_en().contains(w.as_str())
            {
                out.push(w);
            }
        }
    }
    // CJK bigrams: scan original text for runs of CJK chars, emit overlapping 2-grams.
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if is_cjk(chars[i]) {
            let start = i;
            while i < chars.len() && is_cjk(chars[i]) {
                i += 1;
            }
            let run = &chars[start..i];
            if run.len() >= 2 {
                for w in run.windows(2) {
                    let s: String = w.iter().collect();
                    if !stopwords_cjk().contains(s.as_str()) {
                        out.push(s);
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    out
}

pub async fn prompts_wordcloud(
    Query(p): Query<WordcloudQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let top = p.top.unwrap_or(80).clamp(10, 300);
    let agent_filter = p.agent.as_deref().map(str::to_lowercase);
    let mut sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    sessions.retain(|sess| {
        if let Some(af) = &agent_filter {
            let ak = serde_json::to_value(sess.agent)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            return &ak == af;
        }
        true
    });
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut counts: HashMap<String, (u64, std::collections::HashSet<String>)> = HashMap::new();
    for (sess, detail) in pairs {
        for prompt in &detail.prompts {
            let toks = tokenize(&prompt.text);
            let mut seen_in_prompt = std::collections::HashSet::new();
            for t in toks {
                if seen_in_prompt.insert(t.clone()) {
                    let entry = counts
                        .entry(t)
                        .or_insert_with(|| (0, std::collections::HashSet::new()));
                    entry.0 += 1;
                    entry.1.insert(sess.id.clone());
                }
            }
        }
    }
    let mut entries: Vec<WordcloudEntry> = counts
        .into_iter()
        .filter(|(_, (c, _))| *c >= 2)
        .map(|(word, (count, sids))| WordcloudEntry {
            word,
            count,
            sessions: sids.len() as u64,
        })
        .collect();
    entries.sort_by(|a, b| b.count.cmp(&a.count).then(b.sessions.cmp(&a.sessions)));
    entries.truncate(top);
    Json(entries).into_response()
}

#[derive(Debug, Deserialize)]
pub struct ToolTrendQuery {
    #[serde(default)]
    pub hours: Option<u32>,
    #[serde(default)]
    pub top: Option<usize>,
}

#[derive(Debug, Serialize)]
struct ToolSeries {
    name: String,
    counts: Vec<u64>,
    total: u64,
}

pub async fn tools_trend(
    Query(p): Query<ToolTrendQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let hours = p.hours.unwrap_or(168).clamp(1, 24 * 90) as usize;
    let top = p.top.unwrap_or(8).clamp(1, 20);
    let now = chrono::Utc::now();
    let window_start = now - chrono::Duration::hours(hours as i64);

    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut per_tool: HashMap<String, Vec<u64>> = HashMap::new();
    let mut totals: HashMap<String, u64> = HashMap::new();
    for (_, detail) in &pairs {
        for tc in &detail.tool_calls {
            if tc.timestamp < window_start || tc.timestamp > now {
                continue;
            }
            let elapsed = (now - tc.timestamp).num_hours() as usize;
            if elapsed >= hours {
                continue;
            }
            let bucket = hours - 1 - elapsed;
            let entry = per_tool
                .entry(tc.name.clone())
                .or_insert_with(|| vec![0u64; hours]);
            entry[bucket] += 1;
            *totals.entry(tc.name.clone()).or_default() += 1;
        }
    }

    let mut ranked: Vec<(String, u64)> = totals.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1));
    let head: Vec<(String, u64)> = ranked.iter().take(top).cloned().collect();
    let head_names: std::collections::HashSet<String> =
        head.iter().map(|(n, _)| n.clone()).collect();

    let mut other = vec![0u64; hours];
    let mut other_total = 0u64;
    for (name, counts) in &per_tool {
        if head_names.contains(name) {
            continue;
        }
        for (i, c) in counts.iter().enumerate() {
            other[i] += c;
        }
        other_total += counts.iter().sum::<u64>();
    }

    let mut series: Vec<ToolSeries> = head
        .into_iter()
        .map(|(name, total)| ToolSeries {
            counts: per_tool.remove(&name).unwrap_or_else(|| vec![0u64; hours]),
            name,
            total,
        })
        .collect();
    if other_total > 0 {
        series.push(ToolSeries {
            name: "other".into(),
            counts: other,
            total: other_total,
        });
    }

    let totals_per_bucket: Vec<u64> = (0..hours)
        .map(|i| series.iter().map(|s| s.counts[i]).sum())
        .collect();

    Json(serde_json::json!({
        "hours": hours,
        "window_start": window_start.to_rfc3339(),
        "now": now.to_rfc3339(),
        "series": series,
        "totals": totals_per_bucket,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct ToolBucketQuery {
    pub since: String,
    pub until: String,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct BucketHit {
    session_id: String,
    agent: String,
    cwd: Option<String>,
    count: u64,
    last_event_at: String,
}

pub async fn tools_bucket(
    Query(p): Query<ToolBucketQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let since = match chrono::DateTime::parse_from_rfc3339(&p.since) {
        Ok(t) => t.with_timezone(&chrono::Utc),
        Err(e) => return (StatusCode::BAD_REQUEST, format!("since: {e}")).into_response(),
    };
    let until = match chrono::DateTime::parse_from_rfc3339(&p.until) {
        Ok(t) => t.with_timezone(&chrono::Utc),
        Err(e) => return (StatusCode::BAD_REQUEST, format!("until: {e}")).into_response(),
    };
    let limit = p.limit.unwrap_or(50).clamp(1, 200);
    let tool_filter = p.tool.as_deref();

    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;
    let mut hits: Vec<BucketHit> = Vec::new();
    for (sess, detail) in pairs {
        let mut count: u64 = 0;
        for tc in &detail.tool_calls {
            if tc.timestamp < since || tc.timestamp >= until {
                continue;
            }
            if let Some(t) = tool_filter {
                if tc.name != t {
                    continue;
                }
            }
            count += 1;
        }
        if count == 0 {
            continue;
        }
        hits.push(BucketHit {
            session_id: sess.id.clone(),
            agent: format!("{:?}", sess.agent).to_lowercase(),
            cwd: Some(sess.cwd.display().to_string()),
            count,
            last_event_at: sess.last_event_at.to_rfc3339(),
        });
    }
    hits.sort_by(|a, b| b.count.cmp(&a.count));
    hits.truncate(limit);

    Json(hits).into_response()
}

pub async fn list_labels(State(s): State<AppState>) -> impl IntoResponse {
    Json(s.labels.snapshot().await).into_response()
}

pub async fn set_label(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Json(label): Json<crate::labels::Label>,
) -> impl IntoResponse {
    let normalized = crate::labels::Label {
        starred: label.starred,
        tags: label
            .tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty() && t.len() <= 32)
            .take(16)
            .collect(),
        note: label.note.and_then(|n| {
            let trimmed = n.trim();
            if trimmed.is_empty() {
                None
            } else {
                let max = 4096;
                Some(if trimmed.len() <= max {
                    trimmed.to_string()
                } else {
                    trimmed.chars().take(max).collect()
                })
            }
        }),
        custom_name: label.custom_name.and_then(|n| {
            let trimmed = n.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.chars().take(200).collect())
            }
        }),
    };
    match s.labels.set(&id, normalized.clone()).await {
        Ok(()) => Json(normalized).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Copilot configuration ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CopilotPlugin {
    pub name: String,
    pub version: String,
    pub marketplace: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentEntry {
    pub name: String,
    pub description: String,
    pub full_description: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
pub struct CopilotConfigResponse {
    pub instructions: Option<String>,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub plugins: Vec<CopilotPlugin>,
    pub skills_count: usize,
    pub agents: Vec<AgentEntry>,
}

pub async fn copilot_config(State(_state): State<AppState>) -> impl IntoResponse {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot resolve home dir").into_response();
        }
    };

    let copilot_dir = home.join(".copilot");

    // Read copilot-instructions.md
    let instructions_path = copilot_dir.join("copilot-instructions.md");
    let instructions = std::fs::read_to_string(&instructions_path).ok();

    // Read settings.json
    let settings_path = copilot_dir.join("settings.json");
    let (model, effort_level, plugins) = match std::fs::read_to_string(&settings_path) {
        Ok(raw) => {
            let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
            let model = v.get("model").and_then(|m| m.as_str()).map(String::from);
            let effort_level = v
                .get("effortLevel")
                .and_then(|e| e.as_str())
                .map(String::from);
            let plugins = v
                .get("installedPlugins")
                .and_then(|p| p.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|p| {
                            let name = p.get("name")?.as_str()?.to_string();
                            let version = p
                                .get("version")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let marketplace = p
                                .get("marketplace")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            Some(CopilotPlugin {
                                name,
                                version,
                                marketplace,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            (model, effort_level, plugins)
        }
        Err(_) => (None, None, Vec::new()),
    };

    // Count all skills (same sources as /api/skills)
    let home_str = home.to_string_lossy().to_string();
    let skill_sources: Vec<PathBuf> = vec![
        PathBuf::from(format!("{home_str}/.copilot/installed-plugins")),
        PathBuf::from(format!("{home_str}/.claude/skills")),
        PathBuf::from(format!("{home_str}/.agents/skills")),
    ];
    let skills_count: usize = skill_sources
        .iter()
        .map(|d| count_skills_recursive(d, 4))
        .sum();

    // Scan agents from ~/.copilot/agents/ and installed plugins
    let mut agents = scan_agents_dir(&copilot_dir.join("agents"), "user");
    let plugin_agents_dir = copilot_dir
        .join("installed-plugins")
        .join("superpowers-marketplace")
        .join("superpowers")
        .join("agents");
    agents.extend(scan_agents_dir(&plugin_agents_dir, "superpowers"));
    agents.sort_by(|a, b| a.name.cmp(&b.name));

    Json(CopilotConfigResponse {
        instructions,
        model,
        effort_level,
        plugins,
        skills_count,
        agents,
    })
    .into_response()
}

// ── Session instructions ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct InstructionFile {
    pub name: String,
    pub rel_path: String,
    pub content: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct SessionInstructions {
    pub session_id: String,
    pub agent: String,
    pub cwd: String,
    pub project_files: Vec<InstructionFile>,
    pub global_instructions: Option<String>,
}

const MAX_INSTRUCTION_BYTES: usize = 100 * 1024;

fn try_read_instruction(base: &std::path::Path, rel: &str) -> Option<InstructionFile> {
    let path = base.join(rel);
    let content = std::fs::read_to_string(&path).ok()?;
    let bytes = content.len();
    let content = if bytes > MAX_INSTRUCTION_BYTES {
        content[..MAX_INSTRUCTION_BYTES].to_string()
    } else {
        content
    };
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    Some(InstructionFile {
        name,
        rel_path: rel.to_string(),
        content,
        bytes,
    })
}

pub async fn get_session_instructions(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let meta = match sessions.iter().find(|m| m.id == id) {
        Some(m) => m,
        None => return (StatusCode::NOT_FOUND, "session not found").into_response(),
    };
    let cwd = &meta.cwd;
    let agent_str = serde_json::to_value(meta.agent)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let mut project_files = Vec::new();

    // Agent-specific project-level instruction files
    match meta.agent {
        AgentKind::Copilot => {
            if let Some(f) = try_read_instruction(cwd, ".github/copilot-instructions.md") {
                project_files.push(f);
            }
            // Copilot CLI also reads CLAUDE.md if present
            if let Some(f) = try_read_instruction(cwd, "CLAUDE.md") {
                project_files.push(f);
            }
        }
        AgentKind::Claude => {
            if let Some(f) = try_read_instruction(cwd, "CLAUDE.md") {
                project_files.push(f);
            }
        }
        AgentKind::Codex => {
            if let Some(f) = try_read_instruction(cwd, ".codex/AGENTS.md") {
                project_files.push(f);
            }
            if let Some(f) = try_read_instruction(cwd, ".codex/instructions.md") {
                project_files.push(f);
            }
        }
        AgentKind::Gemini => {
            if let Some(f) = try_read_instruction(cwd, "GEMINI.md") {
                project_files.push(f);
            }
        }
        AgentKind::Aider => {
            if let Some(f) = try_read_instruction(cwd, ".aider.conf.yml") {
                project_files.push(f);
            }
        }
        AgentKind::OpenCode => {}
    }

    // Shared: AGENTS.md
    if let Some(f) = try_read_instruction(cwd, "AGENTS.md") {
        project_files.push(f);
    }

    // Global instructions from home dir
    let global_instructions = dirs::home_dir().and_then(|home| match meta.agent {
        AgentKind::Copilot => {
            std::fs::read_to_string(home.join(".copilot/copilot-instructions.md")).ok()
        }
        AgentKind::Claude => std::fs::read_to_string(home.join(".claude/CLAUDE.md")).ok(),
        AgentKind::Codex => std::fs::read_to_string(home.join(".codex/instructions.md")).ok(),
        _ => None,
    });

    Json(SessionInstructions {
        session_id: id,
        agent: agent_str,
        cwd: cwd.to_string_lossy().to_string(),
        project_files,
        global_instructions,
    })
    .into_response()
}

// ── All agents configuration ───────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AgentConfigInfo {
    pub agent: String,
    pub installed: bool,
    pub data_path: Option<String>,
    pub model: Option<String>,
    pub settings: serde_json::Value,
    pub instructions: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AllAgentsConfigResponse {
    pub agents: Vec<AgentConfigInfo>,
}

pub async fn all_agents_config(State(_state): State<AppState>) -> impl IntoResponse {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot resolve home dir").into_response();
        }
    };

    let mut agents = Vec::new();

    // ── Copilot ──
    {
        let dir = home.join(".copilot");
        let installed = dir.is_dir();
        let data_path = if installed {
            Some(dir.to_string_lossy().to_string())
        } else {
            None
        };
        let mut model: Option<String> = None;
        let mut settings = serde_json::Value::Object(serde_json::Map::new());

        if installed {
            if let Ok(raw) = std::fs::read_to_string(dir.join("settings.json")) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    model = v.get("model").and_then(|m| m.as_str()).map(String::from);
                    let effort = v
                        .get("effortLevel")
                        .and_then(|e| e.as_str())
                        .map(String::from);
                    let plugins: Vec<String> = v
                        .get("installedPlugins")
                        .and_then(|p| p.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|p| p.get("name")?.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let mut map = serde_json::Map::new();
                    if let Some(e) = effort {
                        map.insert("effortLevel".into(), serde_json::Value::String(e));
                    }
                    if !plugins.is_empty() {
                        map.insert("plugins".into(), serde_json::json!(plugins));
                    }
                    settings = serde_json::Value::Object(map);
                }
            }
        }

        let instructions = if installed {
            std::fs::read_to_string(dir.join("copilot-instructions.md")).ok()
        } else {
            None
        };

        agents.push(AgentConfigInfo {
            agent: "copilot".into(),
            installed,
            data_path,
            model,
            settings,
            instructions,
        });
    }

    // ── Claude ──
    {
        let dir = home.join(".claude");
        let installed = dir.is_dir();
        let data_path = if installed {
            Some(dir.to_string_lossy().to_string())
        } else {
            None
        };
        let mut settings = serde_json::Value::Object(serde_json::Map::new());

        if installed {
            if let Ok(raw) = std::fs::read_to_string(dir.join("settings.json")) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let mut map = serde_json::Map::new();
                    if let Some(plugins) = v.get("enabledPlugins") {
                        map.insert("enabledPlugins".into(), plugins.clone());
                    }
                    if let Some(mkts) = v.get("extraKnownMarketplaces") {
                        map.insert("extraKnownMarketplaces".into(), mkts.clone());
                    }
                    if !map.is_empty() {
                        settings = serde_json::Value::Object(map);
                    }
                }
            }
        }

        let instructions = if installed {
            std::fs::read_to_string(dir.join("CLAUDE.md")).ok()
        } else {
            None
        };

        agents.push(AgentConfigInfo {
            agent: "claude".into(),
            installed,
            data_path,
            model: None,
            settings,
            instructions,
        });
    }

    // ── OpenCode ──
    {
        let data_dir = home.join(".local").join("share").join("opencode");
        let config_dir = home.join(".config").join("opencode");
        let installed = data_dir.is_dir() || config_dir.is_dir();
        let data_path = if data_dir.is_dir() {
            Some(data_dir.to_string_lossy().to_string())
        } else if config_dir.is_dir() {
            Some(config_dir.to_string_lossy().to_string())
        } else {
            None
        };
        let mut settings = serde_json::Value::Object(serde_json::Map::new());
        let mut instructions: Option<String> = None;

        if let Ok(raw) = std::fs::read_to_string(config_dir.join("auth.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = v.as_object() {
                    let providers: Vec<String> = obj.keys().cloned().collect();
                    if !providers.is_empty() {
                        let mut map = serde_json::Map::new();
                        map.insert("providers".into(), serde_json::json!(providers));
                        settings = serde_json::Value::Object(map);
                    }
                }
            }
        }

        // Read opencode.jsonc for plugins
        if let Ok(raw) = std::fs::read_to_string(config_dir.join("opencode.jsonc")) {
            // Strip single-line comments for JSON parsing
            let stripped: String = raw
                .lines()
                .map(|l| {
                    let trimmed = l.trim_start();
                    if trimmed.starts_with("//") { "" } else { l }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stripped) {
                if let Some(plugins) = v.get("plugin") {
                    if let Some(map) = settings.as_object_mut() {
                        map.insert("plugins".into(), plugins.clone());
                    }
                }
                instructions = v
                    .get("instructions")
                    .and_then(|i| i.as_str())
                    .map(String::from);
            }
        }

        agents.push(AgentConfigInfo {
            agent: "opencode".into(),
            installed,
            data_path,
            model: None,
            settings,
            instructions,
        });
    }

    // ── Codex ──
    {
        let dir = home.join(".codex");
        let installed = dir.is_dir();
        let data_path = if installed {
            Some(dir.to_string_lossy().to_string())
        } else {
            None
        };

        let instructions = if installed {
            std::fs::read_to_string(dir.join("instructions.md")).ok()
        } else {
            None
        };

        agents.push(AgentConfigInfo {
            agent: "codex".into(),
            installed,
            data_path,
            model: None,
            settings: serde_json::Value::Object(serde_json::Map::new()),
            instructions,
        });
    }

    // ── Gemini ──
    {
        let dir = home.join(".gemini");
        let installed = dir.is_dir();
        let data_path = if installed {
            Some(dir.to_string_lossy().to_string())
        } else {
            None
        };

        agents.push(AgentConfigInfo {
            agent: "gemini".into(),
            installed,
            data_path,
            model: None,
            settings: serde_json::Value::Object(serde_json::Map::new()),
            instructions: None,
        });
    }

    // ── Aider ──
    {
        let dir = home.join(".aider");
        let installed = dir.is_dir();
        let data_path = if installed {
            Some(dir.to_string_lossy().to_string())
        } else {
            None
        };

        agents.push(AgentConfigInfo {
            agent: "aider".into(),
            installed,
            data_path,
            model: None,
            settings: serde_json::Value::Object(serde_json::Map::new()),
            instructions: None,
        });
    }

    Json(AllAgentsConfigResponse { agents }).into_response()
}

fn count_skills_recursive(dir: &PathBuf, max_depth: usize) -> usize {
    if max_depth == 0 || !dir.is_dir() {
        return 0;
    }
    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let has_skill = path.join("SKILL.md").is_file()
                    || path.join("skill.md").is_file()
                    || path.join("index.md").is_file();
                if has_skill {
                    count += 1;
                }
                count += count_skills_recursive(&path, max_depth - 1);
            }
        }
    }
    count
}

/// Scan a directory for `*.agent.md` or `*.md` agent definition files.
/// Extracts `name` and `description` from YAML frontmatter.
fn scan_agents_dir(dir: &std::path::Path, source: &str) -> Vec<AgentEntry> {
    let mut agents = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return agents,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name_str = entry.file_name().to_string_lossy().to_string();
        if !name_str.ends_with(".md") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // Parse YAML frontmatter between --- lines
        if !content.starts_with("---") {
            continue;
        }
        let rest = &content[3..];
        let end = match rest.find("\n---") {
            Some(i) => i,
            None => continue,
        };
        let frontmatter = &rest[..end];
        let mut name = None;
        let mut description = None;
        for line in frontmatter.lines() {
            if let Some(v) = line.strip_prefix("name:") {
                name = Some(v.trim().trim_matches('"').to_string());
            } else if let Some(v) = line.strip_prefix("description:") {
                let v = v.trim();
                if v.starts_with('|') {
                    // Multi-line YAML — take next lines until a non-indented line
                    let after_pipe = &frontmatter
                        [line.as_ptr() as usize - frontmatter.as_ptr() as usize + line.len()..];
                    let desc_lines: Vec<&str> = after_pipe
                        .lines()
                        .take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.is_empty())
                        .collect();
                    description = Some(
                        desc_lines
                            .iter()
                            .map(|l| l.trim())
                            .collect::<Vec<_>>()
                            .join(" ")
                            .trim()
                            .to_string(),
                    );
                } else {
                    description = Some(v.trim_matches('"').to_string());
                }
            }
        }
        // Truncate long descriptions to first sentence for summary
        let desc = description.unwrap_or_default();
        let short_desc = desc
            .split_once(". ")
            .or_else(|| desc.split_once("。"))
            .map(|(s, _)| format!("{}.", s.trim_end_matches('.')))
            .unwrap_or_else(|| {
                if desc.len() > 200 {
                    format!("{}…", &desc[..200])
                } else {
                    desc.clone()
                }
            });
        if let Some(n) = name {
            agents.push(AgentEntry {
                name: n,
                description: short_desc,
                full_description: desc,
                source: source.to_string(),
            });
        }
    }
    agents
}

pub async fn list_hidden(State(s): State<AppState>) -> impl IntoResponse {
    let hidden = s.hidden.snapshot().await;
    Json(serde_json::json!({ "hidden": hidden })).into_response()
}

pub async fn hide_session(Path(id): Path<String>, State(s): State<AppState>) -> impl IntoResponse {
    match s.hidden.hide(&id).await {
        Ok(()) => Json(serde_json::json!({ "hidden": true, "id": id })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn unhide_session(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    match s.hidden.unhide(&id).await {
        Ok(()) => Json(serde_json::json!({ "hidden": false, "id": id })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn delete_session(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    match s.adapter.delete_session(&id).await {
        Ok(trash_path) => {
            let _ = s.hidden.unhide(&id).await;
            s.detail_cache.invalidate(&id).await;
            Json(serde_json::json!({
                "deleted": true,
                "id": id,
                "trash_path": trash_path,
            }))
            .into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AnalyticsQuery {
    #[serde(default = "default_analytics_days")]
    pub days: u32,
    #[serde(default)]
    pub agent: Option<String>,
}
fn default_analytics_days() -> u32 {
    30
}

#[derive(Serialize)]
struct AnalyticsResponse {
    days: u32,
    agent_filter: Option<String>,
    total_sessions: u32,
    avg_duration_mins: f64,
    median_duration_mins: f64,
    p90_duration_mins: f64,
    duration_buckets: Vec<HistogramBucket>,
    avg_turns: f64,
    avg_user_messages: f64,
    engaged_sessions: u32,
    short_sessions: u32,
    completed_sessions: u32,
    tokens_by_agent: Vec<AgentTokens>,
    tokens_by_model: Vec<ModelTokens>,
    tool_heatmap: Vec<ToolHeatmapRow>,
    top_tools: Vec<ToolRank>,
    daily: Vec<DayCount>,
    agent_stats: Vec<AgentComparison>,
}

#[derive(Serialize)]
struct HistogramBucket {
    label: String,
    count: u32,
    pct: f64,
}

#[derive(Serialize)]
struct AgentTokens {
    agent: String,
    tokens_in: u64,
    tokens_out: u64,
    sessions: u32,
    avg_per_session: u64,
}

#[derive(Serialize)]
struct ModelTokens {
    model: String,
    tokens_in: u64,
    tokens_out: u64,
    sessions: u32,
}

#[derive(Serialize)]
struct ToolHeatmapRow {
    tool: String,
    hours: Vec<u32>,
}

#[derive(Serialize)]
struct ToolRank {
    name: String,
    count: u32,
    sessions: u32,
}

#[derive(Serialize)]
struct DayCount {
    date: String,
    count: u32,
    tokens_in: u64,
    tokens_out: u64,
}

#[derive(Serialize)]
struct AgentComparison {
    agent: String,
    sessions: u32,
    avg_turns: f64,
    avg_duration_mins: f64,
    avg_tokens_in: u64,
    avg_tokens_out: u64,
}

pub async fn analytics(
    Query(q): Query<AnalyticsQuery>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let pairs = s.detail_cache.fan_out(&s.adapter, &sessions).await;

    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::days(q.days as i64);

    let filtered: Vec<_> = pairs
        .into_iter()
        .filter(|(meta, _)| {
            if meta.started_at < cutoff {
                return false;
            }
            if let Some(ref agent_filter) = q.agent {
                let agent_key = serde_json::to_value(meta.agent)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                if &agent_key != agent_filter {
                    return false;
                }
            }
            true
        })
        .collect();

    let total_sessions = filtered.len() as u32;

    // Duration stats (completed sessions only)
    let mut durations: Vec<f64> = Vec::new();
    for (meta, _) in &filtered {
        if meta.status != SessionStatus::Active {
            let mins = (meta.last_event_at - meta.started_at).num_seconds() as f64 / 60.0;
            durations.push(mins.max(0.0));
        }
    }
    durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let completed_sessions = durations.len() as u32;
    let avg_duration_mins = if durations.is_empty() {
        0.0
    } else {
        durations.iter().sum::<f64>() / durations.len() as f64
    };
    let median_duration_mins = if durations.is_empty() {
        0.0
    } else {
        durations[durations.len() / 2]
    };
    let p90_duration_mins = if durations.is_empty() {
        0.0
    } else {
        let idx = ((durations.len() as f64 * 0.9).ceil() as usize).min(durations.len()) - 1;
        durations[idx]
    };

    // Duration buckets
    let bucket_labels = ["<5m", "5-15m", "15-30m", "30m-1h", "1-2h", "2h+"];
    let bucket_bounds: [f64; 5] = [5.0, 15.0, 30.0, 60.0, 120.0];
    let mut bucket_counts = [0u32; 6];
    for &d in &durations {
        let idx = bucket_bounds.iter().position(|&b| d < b).unwrap_or(5);
        bucket_counts[idx] += 1;
    }
    let duration_buckets: Vec<HistogramBucket> = bucket_labels
        .iter()
        .enumerate()
        .map(|(i, label)| HistogramBucket {
            label: label.to_string(),
            count: bucket_counts[i],
            pct: if completed_sessions == 0 {
                0.0
            } else {
                bucket_counts[i] as f64 / completed_sessions as f64 * 100.0
            },
        })
        .collect();

    // Interaction depth
    let (mut sum_turns, mut sum_user_msgs) = (0u64, 0u64);
    let mut engaged_sessions = 0u32;
    let mut short_sessions = 0u32;
    for (meta, detail) in &filtered {
        sum_turns += detail.turns as u64;
        sum_user_msgs += detail.user_messages as u64;
        if meta.status != SessionStatus::Active {
            let total_tc: u32 = detail.tool_calls.len() as u32;
            if detail.turns >= 3 || total_tc > 0 {
                engaged_sessions += 1;
            }
            if detail.turns < 2 {
                short_sessions += 1;
            }
        }
    }
    let avg_turns = if total_sessions == 0 {
        0.0
    } else {
        sum_turns as f64 / total_sessions as f64
    };
    let avg_user_messages = if total_sessions == 0 {
        0.0
    } else {
        sum_user_msgs as f64 / total_sessions as f64
    };

    // Tokens by agent
    struct AgentAccum {
        tokens_in: u64,
        tokens_out: u64,
        sessions: u32,
        turns: u64,
        duration_sum: f64,
        duration_count: u32,
    }
    let mut agent_map: HashMap<String, AgentAccum> = HashMap::new();
    for (meta, detail) in &filtered {
        let agent_key = serde_json::to_value(meta.agent)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        let e = agent_map.entry(agent_key).or_insert(AgentAccum {
            tokens_in: 0,
            tokens_out: 0,
            sessions: 0,
            turns: 0,
            duration_sum: 0.0,
            duration_count: 0,
        });
        e.tokens_in += detail.tokens_in;
        e.tokens_out += detail.tokens_out;
        e.sessions += 1;
        e.turns += detail.turns as u64;
        if meta.status != SessionStatus::Active {
            let mins = (meta.last_event_at - meta.started_at).num_seconds() as f64 / 60.0;
            e.duration_sum += mins.max(0.0);
            e.duration_count += 1;
        }
    }
    let mut tokens_by_agent: Vec<AgentTokens> = agent_map
        .iter()
        .map(|(agent, a)| {
            let total = a.tokens_in + a.tokens_out;
            AgentTokens {
                agent: agent.clone(),
                tokens_in: a.tokens_in,
                tokens_out: a.tokens_out,
                sessions: a.sessions,
                avg_per_session: if a.sessions == 0 {
                    0
                } else {
                    total / a.sessions as u64
                },
            }
        })
        .collect();
    tokens_by_agent.sort_by(|a, b| b.sessions.cmp(&a.sessions));

    let agent_stats: Vec<AgentComparison> = agent_map
        .iter()
        .map(|(agent, a)| AgentComparison {
            agent: agent.clone(),
            sessions: a.sessions,
            avg_turns: if a.sessions == 0 {
                0.0
            } else {
                a.turns as f64 / a.sessions as f64
            },
            avg_duration_mins: if a.duration_count == 0 {
                0.0
            } else {
                a.duration_sum / a.duration_count as f64
            },
            avg_tokens_in: if a.sessions == 0 {
                0
            } else {
                a.tokens_in / a.sessions as u64
            },
            avg_tokens_out: if a.sessions == 0 {
                0
            } else {
                a.tokens_out / a.sessions as u64
            },
        })
        .collect();

    // Tokens by model
    struct ModelAccum {
        tokens_in: u64,
        tokens_out: u64,
        sessions: u32,
    }
    let mut model_map: HashMap<String, ModelAccum> = HashMap::new();
    for (meta, detail) in &filtered {
        let model_key = meta.model.clone().unwrap_or_else(|| "unknown".to_string());
        let e = model_map.entry(model_key).or_insert(ModelAccum {
            tokens_in: 0,
            tokens_out: 0,
            sessions: 0,
        });
        e.tokens_in += detail.tokens_in;
        e.tokens_out += detail.tokens_out;
        e.sessions += 1;
    }
    let mut tokens_by_model: Vec<ModelTokens> = model_map
        .into_iter()
        .map(|(model, m)| ModelTokens {
            model,
            tokens_in: m.tokens_in,
            tokens_out: m.tokens_out,
            sessions: m.sessions,
        })
        .collect();
    tokens_by_model.sort_by(|a, b| b.sessions.cmp(&a.sessions));

    // Tool heatmap & top tools
    let mut tool_total: HashMap<String, u32> = HashMap::new();
    let mut tool_sessions: HashMap<String, std::collections::HashSet<usize>> = HashMap::new();
    let mut tool_hours: HashMap<String, [u32; 24]> = HashMap::new();
    for (idx, (_meta, detail)) in filtered.iter().enumerate() {
        for tc in &detail.tool_calls {
            *tool_total.entry(tc.name.clone()).or_default() += 1;
            tool_sessions
                .entry(tc.name.clone())
                .or_default()
                .insert(idx);
            let hour = tc.timestamp.with_timezone(&chrono::Local).hour() as usize;
            tool_hours.entry(tc.name.clone()).or_insert([0u32; 24])[hour] += 1;
        }
    }
    let mut tool_rank: Vec<(String, u32)> =
        tool_total.iter().map(|(k, &v)| (k.clone(), v)).collect();
    tool_rank.sort_by(|a, b| b.1.cmp(&a.1));

    let top_tools: Vec<ToolRank> = tool_rank
        .iter()
        .take(10)
        .map(|(name, count)| ToolRank {
            name: name.clone(),
            count: *count,
            sessions: tool_sessions.get(name).map(|s| s.len() as u32).unwrap_or(0),
        })
        .collect();

    let tool_heatmap: Vec<ToolHeatmapRow> = tool_rank
        .iter()
        .take(10)
        .map(|(name, _)| {
            let hours = tool_hours
                .get(name)
                .map(|h| h.to_vec())
                .unwrap_or_else(|| vec![0u32; 24]);
            ToolHeatmapRow {
                tool: name.clone(),
                hours,
            }
        })
        .collect();

    // Daily counts
    let mut daily_map: HashMap<chrono::NaiveDate, (u32, u64, u64)> = HashMap::new();
    for (meta, detail) in &filtered {
        let date = meta.started_at.with_timezone(&chrono::Local).date_naive();
        let e = daily_map.entry(date).or_insert((0, 0, 0));
        e.0 += 1;
        e.1 += detail.tokens_in;
        e.2 += detail.tokens_out;
    }
    let mut daily: Vec<DayCount> = daily_map
        .into_iter()
        .map(|(date, (count, ti, to))| DayCount {
            date: date.format("%Y-%m-%d").to_string(),
            count,
            tokens_in: ti,
            tokens_out: to,
        })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));

    let resp = AnalyticsResponse {
        days: q.days,
        agent_filter: q.agent,
        total_sessions,
        avg_duration_mins,
        median_duration_mins,
        p90_duration_mins,
        duration_buckets,
        avg_turns,
        avg_user_messages,
        engaged_sessions,
        short_sessions,
        completed_sessions,
        tokens_by_agent,
        tokens_by_model,
        tool_heatmap,
        top_tools,
        daily,
        agent_stats,
    };
    Json(resp).into_response()
}

// ── Session Context (Copilot CLI session-state) ─────────────────────

#[derive(Serialize)]
pub struct SessionContext {
    plan: Option<String>,
    checkpoints: Vec<CheckpointEntry>,
    todos: Vec<TodoEntry>,
    has_context: bool,
}

#[derive(Serialize)]
pub struct CheckpointEntry {
    filename: String,
    title: String,
    content: String,
    /// Parsed sections from checkpoint XML-like format
    sections: CheckpointSections,
}

#[derive(Serialize, Default)]
pub struct CheckpointSections {
    overview: Option<String>,
    history: Option<String>,
    work_done: Option<String>,
    technical_details: Option<String>,
    important_files: Option<String>,
    next_steps: Option<String>,
}

#[derive(Serialize)]
pub struct TodoEntry {
    id: String,
    title: String,
    description: String,
    status: String,
}

pub async fn get_session_context(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    // Only copilot sessions have session-state dirs
    let is_copilot = match s.adapter.list_sessions().await {
        Ok(v) => v.iter().any(|m| m.id == id && m.agent == AgentKind::Copilot),
        Err(_) => false,
    };
    if !is_copilot {
        return Json(SessionContext {
            plan: None,
            checkpoints: vec![],
            todos: vec![],
            has_context: false,
        })
        .into_response();
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return Json(SessionContext {
                plan: None,
                checkpoints: vec![],
                todos: vec![],
                has_context: false,
            })
            .into_response();
        }
    };

    let session_dir = home.join(".copilot/session-state").join(&id);
    if !session_dir.is_dir() {
        return Json(SessionContext {
            plan: None,
            checkpoints: vec![],
            todos: vec![],
            has_context: false,
        })
        .into_response();
    }

    // Read plan.md
    let plan = tokio::fs::read_to_string(session_dir.join("plan.md"))
        .await
        .ok()
        .filter(|s| !s.trim().is_empty());

    // Read checkpoints
    let checkpoints = read_checkpoints(&session_dir).await;

    // Read todos via sqlite3 CLI
    let todos = read_todos(&session_dir).await;

    let has_context = plan.is_some() || !checkpoints.is_empty() || !todos.is_empty();

    Json(SessionContext {
        plan,
        checkpoints,
        todos,
        has_context,
    })
    .into_response()
}

async fn read_checkpoints(session_dir: &std::path::Path) -> Vec<CheckpointEntry> {
    let cp_dir = session_dir.join("checkpoints");
    let mut entries = Vec::new();
    let mut dir = match tokio::fs::read_dir(&cp_dir).await {
        Ok(d) => d,
        Err(_) => return entries,
    };
    let mut filenames = Vec::new();
    while let Ok(Some(entry)) = dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") && name != "index.md" {
            filenames.push(name);
        }
    }
    filenames.sort();
    for name in filenames {
        let path = cp_dir.join(&name);
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        let title = checkpoint_title(&name);
        let sections = parse_checkpoint_sections(&content);
        entries.push(CheckpointEntry {
            filename: name,
            title,
            content,
            sections,
        });
    }
    entries
}

fn parse_checkpoint_sections(content: &str) -> CheckpointSections {
    let mut sections = CheckpointSections::default();
    let tags = [
        ("overview", &mut sections.overview as &mut Option<String>),
        ("history", &mut sections.history),
        ("work_done", &mut sections.work_done),
        ("technical_details", &mut sections.technical_details),
        ("important_files", &mut sections.important_files),
        ("next_steps", &mut sections.next_steps),
    ];
    for (tag, field) in tags {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        if let Some(start) = content.find(&open) {
            if let Some(end) = content[start..].find(&close) {
                let inner = &content[start + open.len()..start + end];
                let trimmed = inner.trim();
                if !trimmed.is_empty() {
                    *field = Some(trimmed.to_string());
                }
            }
        }
    }
    sections
}

fn checkpoint_title(filename: &str) -> String {
    let stem = filename.strip_suffix(".md").unwrap_or(filename);
    // Strip leading number prefix like "001-"
    let stripped = if let Some(rest) = stem.strip_prefix(|c: char| c.is_ascii_digit()) {
        let rest = rest.trim_start_matches(|c: char| c.is_ascii_digit());
        rest.strip_prefix('-').unwrap_or(rest)
    } else {
        stem
    };
    let title = stripped.replace('-', " ");
    let mut chars = title.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

async fn read_todos(session_dir: &std::path::Path) -> Vec<TodoEntry> {
    let db_path = session_dir.join("session.db");
    if !db_path.exists() {
        return vec![];
    }
    let output = tokio::process::Command::new("sqlite3")
        .arg(&db_path)
        .arg("-separator")
        .arg("\t")
        .arg(
            "SELECT id, title, COALESCE(description,''), status FROM todos \
             ORDER BY CASE status \
               WHEN 'in_progress' THEN 0 \
               WHEN 'pending' THEN 1 \
               WHEN 'blocked' THEN 2 \
               WHEN 'done' THEN 3 END;",
        )
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(4, '\t').collect();
                if parts.len() >= 4 {
                    Some(TodoEntry {
                        id: parts[0].to_string(),
                        title: parts[1].to_string(),
                        description: parts[2].to_string(),
                        status: parts[3].to_string(),
                    })
                } else {
                    None
                }
            })
            .collect(),
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Projects listing (for install target selector)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ProjectEntry {
    path: String,
    name: String,
}

/// GET /api/projects — list known projects from session CWDs
pub async fn list_projects(State(s): State<AppState>) -> impl IntoResponse {
    let sessions = match s.adapter.list_sessions().await {
        Ok(v) => v,
        Err(_) => vec![],
    };

    let mut seen = std::collections::HashSet::new();
    let mut projects: Vec<ProjectEntry> = Vec::new();

    for session in &sessions {
        let path_str = session.cwd.display().to_string();
        if seen.contains(&path_str) {
            continue;
        }
        seen.insert(path_str.clone());
        let name = session
            .cwd
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        projects.push(ProjectEntry {
            path: path_str,
            name,
        });
    }

    projects.sort_by(|a, b| a.name.cmp(&b.name));

    Json(serde_json::json!({ "projects": projects }))
}

// ---------------------------------------------------------------------------
// Open directory in system file manager
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OpenDirBody {
    pub path: String,
}

pub async fn open_dir(Json(body): Json<OpenDirBody>) -> impl IntoResponse {
    let path = std::path::Path::new(&body.path);
    if !path.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Not a directory"}))).into_response();
    }
    let result = std::process::Command::new("open").arg(&body.path).spawn();
    match result {
        Ok(_) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}
