use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::AppState;
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthData {
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub github_login: String,
    #[serde(default)]
    pub github_avatar: String,
    #[serde(default)]
    pub github_name: String,
    #[serde(default)]
    pub sync_repo: String,
    #[serde(default)]
    pub last_sync: Option<DateTime<Utc>>,
    #[serde(default)]
    pub device_id: String,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AuthStore {
    path: PathBuf,
    inner: Arc<RwLock<AuthData>>,
}

fn default_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pawscope")
        .join("auth.json")
}

impl AuthStore {
    pub async fn load() -> Self {
        Self::load_from(default_path()).await
    }

    pub async fn load_from(path: PathBuf) -> Self {
        let mut data = tokio::fs::read_to_string(&path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<AuthData>(&s).ok())
            .unwrap_or_default();
        if data.device_id.is_empty() {
            data.device_id = uuid::Uuid::new_v4().to_string();
        }
        Self {
            path,
            inner: Arc::new(RwLock::new(data)),
        }
    }

    pub async fn snapshot(&self) -> AuthData {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, data: AuthData) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            *g = data;
        }
        self.persist().await
    }

    pub async fn update_last_sync(&self) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            g.last_sync = Some(Utc::now());
        }
        self.persist().await
    }

    pub async fn clear(&self) -> std::io::Result<()> {
        let device_id = self.inner.read().await.device_id.clone();
        {
            let mut g = self.inner.write().await;
            *g = AuthData {
                device_id,
                ..Default::default()
            };
        }
        self.persist().await
    }

    async fn persist(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let snap = self.inner.read().await;
        let body = serde_json::to_string_pretty(&*snap).map_err(std::io::Error::other)?;
        tokio::fs::write(&self.path, &body).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginBody {
    pub token: String,
    pub repo: String,
}

/// POST /api/auth/login
pub async fn login(
    State(s): State<AppState>,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let client = reqwest::Client::new();

    // Validate token
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", body.token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Pawscope")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await;

    let user_resp = match user_resp {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": format!("GitHub API error: {e}")})),
            )
                .into_response();
        }
    };

    if !user_resp.status().is_success() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid GitHub token"})),
        )
            .into_response();
    }

    let user_json: serde_json::Value = match user_resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": format!("Failed to parse user: {e}")})),
            )
                .into_response();
        }
    };

    let login = user_json["login"].as_str().unwrap_or("").to_string();
    let avatar = user_json["avatar_url"].as_str().unwrap_or("").to_string();
    let name = user_json["name"].as_str().unwrap_or("").to_string();

    // Validate repo access
    let repo_url = format!("https://api.github.com/repos/{}", body.repo);
    let repo_resp = client
        .get(&repo_url)
        .header("Authorization", format!("Bearer {}", body.token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Pawscope")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await;

    match repo_resp {
        Ok(r) if !r.status().is_success() => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": format!("Cannot access repo: {}", body.repo)})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": format!("Repo check failed: {e}")})),
            )
                .into_response();
        }
        _ => {}
    }

    // Store auth data
    let existing = s.auth.snapshot().await;
    let data = AuthData {
        github_token: body.token,
        github_login: login.clone(),
        github_avatar: avatar.clone(),
        github_name: name.clone(),
        sync_repo: body.repo,
        last_sync: existing.last_sync,
        device_id: existing.device_id,
    };

    if let Err(e) = s.auth.set(data).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to persist auth: {e}")})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "ok": true,
        "user": {
            "login": login,
            "avatar_url": avatar,
            "name": name,
        }
    }))
    .into_response()
}

/// GET /api/auth/status
pub async fn status(State(s): State<AppState>) -> impl IntoResponse {
    let data = s.auth.snapshot().await;
    let logged_in = !data.github_token.is_empty();
    if logged_in {
        Json(serde_json::json!({
            "logged_in": true,
            "user": {
                "login": data.github_login,
                "avatar_url": data.github_avatar,
                "name": data.github_name,
            },
            "sync_repo": data.sync_repo,
            "last_sync": data.last_sync,
        }))
    } else {
        Json(serde_json::json!({
            "logged_in": false,
            "user": null,
            "sync_repo": null,
            "last_sync": null,
        }))
    }
}

/// POST /api/auth/logout
pub async fn logout(State(s): State<AppState>) -> impl IntoResponse {
    if let Err(e) = s.auth.clear().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response();
    }
    Json(serde_json::json!({"ok": true})).into_response()
}
