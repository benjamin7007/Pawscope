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
        last_event_at: Option<chrono::DateTime<chrono::Utc>>,
        agents: std::collections::BTreeSet<String>,
    }
    let mut realms: HashMap<String, Realm> = HashMap::new();
    let mut sess_realm_key: HashMap<String, String> = HashMap::new();

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
            (id, detail)
        }));
    }
    for h in handles {
        if let Ok((sid, Ok(d))) = h.await {
            total_turns += d.turns as u64;
            total_user_msgs += d.user_messages as u64;
            total_assistant_msgs += d.assistant_messages as u64;
            let session_tools: u64 = d.tools_used.values().map(|&v| v as u64).sum();
            if let Some(key) = sess_realm_key.get(&sid) {
                if let Some(r) = realms.get_mut(key) {
                    r.turns += d.turns as u64;
                    r.tool_calls += session_tools;
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
