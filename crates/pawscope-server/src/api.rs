use crate::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use pawscope_core::SessionStatus;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub async fn list_sessions(State(s): State<AppState>) -> impl IntoResponse {
    match s.adapter.list_sessions().await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_detail(Path(id): Path<String>, State(s): State<AppState>) -> impl IntoResponse {
    match s.adapter.get_detail(&id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
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

    Json(serde_json::json!({
        "total_sessions": total,
        "active_sessions": active,
        "by_agent": by_agent,
        "by_repo": by_repo,
        "total_turns": total_turns,
        "total_user_messages": total_user_msgs,
        "total_assistant_messages": total_assistant_msgs,
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
            });
        }
    }
    hits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    hits.truncate(limit);
    Json(hits).into_response()
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
    };
    match s.labels.set(&id, normalized.clone()).await {
        Ok(()) => Json(normalized).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
