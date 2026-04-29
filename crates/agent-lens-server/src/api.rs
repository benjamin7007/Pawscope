use crate::AppState;
use agent_lens_core::SessionStatus;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
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

    let realm_key = |sess: &agent_lens_core::SessionMeta| -> String {
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
    let mut detail_map: BTreeMap<String, agent_lens_core::SessionDetail> = BTreeMap::new();
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
