use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::my_skills::MySkill;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

// ---------------------------------------------------------------------------
// Sync envelope
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct SyncEnvelope {
    version: u32,
    updated_at: DateTime<Utc>,
    device_id: String,
    skills: Vec<MySkill>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn github_headers(token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Authorization", format!("Bearer {token}")),
        ("Accept", "application/vnd.github+json".to_string()),
        ("User-Agent", "Pawscope".to_string()),
        ("X-GitHub-Api-Version", "2022-11-28".to_string()),
    ]
}

async fn get_remote_file(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
) -> Result<Option<(String, String)>, String> {
    let url = format!(
        "https://api.github.com/repos/{repo}/contents/pawscope-my-skills.json"
    );
    let mut req = client.get(&url);
    for (k, v) in github_headers(token) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub GET failed: {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let sha = body["sha"].as_str().unwrap_or("").to_string();
    let content = body["content"].as_str().unwrap_or("").to_string();
    // GitHub returns base64 with newlines
    let clean = content.replace('\n', "");
    Ok(Some((clean, sha)))
}

async fn put_remote_file(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    content_b64: &str,
    sha: Option<&str>,
    message: &str,
) -> Result<(), String> {
    let url = format!(
        "https://api.github.com/repos/{repo}/contents/pawscope-my-skills.json"
    );
    let mut payload = serde_json::json!({
        "message": message,
        "content": content_b64,
    });
    if let Some(sha) = sha {
        payload["sha"] = serde_json::Value::String(sha.to_string());
    }
    let mut req = client.put(&url);
    for (k, v) in github_headers(token) {
        req = req.header(k, v);
    }
    let resp = req.json(&payload).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub PUT failed: {status} — {body}"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/// POST /api/sync/push
pub async fn push(State(s): State<AppState>) -> impl IntoResponse {
    let auth = s.auth.snapshot().await;
    if auth.github_token.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Not logged in"})),
        )
            .into_response();
    }

    let client = reqwest::Client::new();
    let skills_data = s.my_skills.snapshot().await;
    let count = skills_data.skills.len();

    // Get current SHA if exists
    let remote = match get_remote_file(&client, &auth.github_token, &auth.sync_repo).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };

    let envelope = SyncEnvelope {
        version: 1,
        updated_at: Utc::now(),
        device_id: auth.device_id.clone(),
        skills: skills_data.skills,
    };
    let json_bytes =
        serde_json::to_string_pretty(&envelope).unwrap_or_default();
    let content_b64 = B64.encode(json_bytes.as_bytes());

    let sha = remote.as_ref().map(|(_, sha)| sha.as_str());
    let message = format!("sync: update my-skills from {}", auth.device_id);

    if let Err(e) =
        put_remote_file(&client, &auth.github_token, &auth.sync_repo, &content_b64, sha, &message)
            .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response();
    }

    let _ = s.auth.update_last_sync().await;

    Json(serde_json::json!({"ok": true, "pushed": count})).into_response()
}

/// POST /api/sync/pull
pub async fn pull(State(s): State<AppState>) -> impl IntoResponse {
    let auth = s.auth.snapshot().await;
    if auth.github_token.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Not logged in"})),
        )
            .into_response();
    }

    let client = reqwest::Client::new();
    let remote = match get_remote_file(&client, &auth.github_token, &auth.sync_repo).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };

    let (content_b64, _sha) = match remote {
        Some(r) => r,
        None => {
            return Json(
                serde_json::json!({"ok": true, "pulled": 0, "message": "no remote data"}),
            )
            .into_response();
        }
    };

    let decoded = match B64.decode(&content_b64) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("base64 decode: {e}")})),
            )
                .into_response();
        }
    };

    let envelope: SyncEnvelope = match serde_json::from_slice(&decoded) {
        Ok(e) => e,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("JSON parse: {e}")})),
            )
                .into_response();
        }
    };

    // Merge: local wins for same id
    let local = s.my_skills.snapshot().await;
    let local_ids: std::collections::HashSet<String> =
        local.skills.iter().map(|s| s.id.clone()).collect();

    let mut merged = local.skills.clone();
    let mut new_count = 0usize;
    for remote_skill in envelope.skills {
        if !local_ids.contains(&remote_skill.id) {
            merged.push(remote_skill);
            new_count += 1;
        }
    }

    let total = merged.len();
    if let Err(e) = s.my_skills.replace_all(merged).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response();
    }

    let _ = s.auth.update_last_sync().await;

    Json(serde_json::json!({"ok": true, "pulled": new_count, "total": total})).into_response()
}

/// POST /api/sync/sync — full bidirectional sync
pub async fn sync_all(State(s): State<AppState>) -> impl IntoResponse {
    let auth = s.auth.snapshot().await;
    if auth.github_token.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Not logged in"})),
        )
            .into_response();
    }

    let client = reqwest::Client::new();

    // --- Pull phase ---
    let remote = match get_remote_file(&client, &auth.github_token, &auth.sync_repo).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };

    let mut pulled = 0usize;
    if let Some((content_b64, _)) = &remote {
        if let Ok(decoded) = B64.decode(content_b64) {
            if let Ok(envelope) = serde_json::from_slice::<SyncEnvelope>(&decoded) {
                let local = s.my_skills.snapshot().await;
                let local_ids: std::collections::HashSet<String> =
                    local.skills.iter().map(|sk| sk.id.clone()).collect();
                let mut merged = local.skills.clone();
                for remote_skill in envelope.skills {
                    if !local_ids.contains(&remote_skill.id) {
                        merged.push(remote_skill);
                        pulled += 1;
                    }
                }
                let _ = s.my_skills.replace_all(merged).await;
            }
        }
    }

    // --- Push phase ---
    let skills_data = s.my_skills.snapshot().await;
    let total = skills_data.skills.len();

    let envelope = SyncEnvelope {
        version: 1,
        updated_at: Utc::now(),
        device_id: auth.device_id.clone(),
        skills: skills_data.skills,
    };
    let json_bytes = serde_json::to_string_pretty(&envelope).unwrap_or_default();
    let content_b64 = B64.encode(json_bytes.as_bytes());

    // Re-fetch SHA after potential pull merge
    let remote2 = match get_remote_file(&client, &auth.github_token, &auth.sync_repo).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };
    let sha = remote2.as_ref().map(|(_, sha)| sha.as_str());
    let message = format!("sync: update my-skills from {}", auth.device_id);

    if let Err(e) =
        put_remote_file(&client, &auth.github_token, &auth.sync_repo, &content_b64, sha, &message)
            .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response();
    }

    let _ = s.auth.update_last_sync().await;

    Json(serde_json::json!({
        "ok": true,
        "pulled": pulled,
        "pushed": total,
        "total": total,
    }))
    .into_response()
}
