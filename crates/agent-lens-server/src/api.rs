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
    }))
    .into_response()
}
