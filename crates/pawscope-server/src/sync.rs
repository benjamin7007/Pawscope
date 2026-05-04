use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::AppState;
use crate::my_skills::MySkill;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

// ---------------------------------------------------------------------------
// Sync envelope (kept for JSON metadata format)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct SyncEnvelope {
    version: u32,
    updated_at: DateTime<Utc>,
    device_id: String,
    skills: Vec<MySkill>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_TIMEOUT: Duration = Duration::from_secs(120);

const EXCLUDE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    "dist",
    "build",
    ".next",
];

const EXCLUDE_FILES: &[&str] = &[".DS_Store", ".env", ".env.local"];

const EXCLUDE_EXTS: &[&str] = &["pyc", "pyo"];

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

fn git_command(repo_dir: &Path, token: &str) -> std::process::Command {
    let auth_b64 = B64.encode(format!("x-access-token:{token}").as_bytes());
    let extraheader = format!("Authorization: basic {auth_b64}");
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(repo_dir);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.arg("-c")
        .arg(format!("http.https://github.com/.extraheader={extraheader}"));
    cmd
}

async fn run_git(
    repo_dir: &Path,
    token: &str,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = git_command(repo_dir, token);
    for a in args {
        cmd.arg(a);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let dir = repo_dir.to_path_buf();
    let output = tokio::time::timeout(GIT_TIMEOUT, tokio::task::spawn_blocking(move || cmd.output()))
        .await
        .map_err(|_| "git operation timed out (>60s)".to_string())?
        .map_err(|e| format!("spawn error: {e}"))?
        .map_err(|e| format!("git exec error: {e} (dir={dir:?})"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            stderr.trim()
        ))
    }
}

/// Run a simple git command that doesn't need token auth in extraheader.
async fn run_git_bare(
    repo_dir: &Path,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(repo_dir);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    for a in args {
        cmd.arg(a);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let dir = repo_dir.to_path_buf();
    let output = tokio::time::timeout(GIT_TIMEOUT, tokio::task::spawn_blocking(move || cmd.output()))
        .await
        .map_err(|_| "git operation timed out (>60s)".to_string())?
        .map_err(|e| format!("spawn error: {e}"))?
        .map_err(|e| format!("git exec error: {e} (dir={dir:?})"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            stderr.trim()
        ))
    }
}

/// Clone the sync repo into `dest` using token auth.
async fn clone_repo(token: &str, repo: &str, dest: &Path) -> Result<(), String> {
    let auth_b64 = B64.encode(format!("x-access-token:{token}").as_bytes());
    let extraheader = format!("Authorization: basic {auth_b64}");
    let url = format!("https://github.com/{repo}.git");
    let dest_str = dest
        .to_str()
        .ok_or_else(|| "invalid temp dir path".to_string())?
        .to_string();

    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            std::process::Command::new("git")
                .env("GIT_TERMINAL_PROMPT", "0")
                .arg("-c")
                .arg(format!("http.https://github.com/.extraheader={extraheader}"))
                .arg("clone")
                .arg("--depth")
                .arg("1")
                .arg(&url)
                .arg(&dest_str)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
        }),
    )
    .await
    .map_err(|_| "git clone timed out (>60s)".to_string())?
    .map_err(|e| format!("spawn error: {e}"))?
    .map_err(|e| format!("git clone exec error: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr.trim()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("..")
        && !name.contains('/')
        && !name.contains('\\')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn should_exclude(name: &str, is_dir: bool) -> bool {
    if is_dir {
        return EXCLUDE_DIRS.contains(&name);
    }
    if EXCLUDE_FILES.contains(&name) {
        return true;
    }
    if let Some(ext) = Path::new(name).extension().and_then(|e| e.to_str()) {
        if EXCLUDE_EXTS.contains(&ext) {
            return true;
        }
    }
    false
}

/// Recursively copy `src` → `dst`, skipping symlinks and excluded patterns.
/// Returns the number of files copied.
fn copy_skill_dir(src: &Path, dst: &Path) -> std::io::Result<u64> {
    let mut count = 0u64;
    if !src.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;

        // Skip symlinks
        if ft.is_symlink() {
            continue;
        }

        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if ft.is_dir() {
            if should_exclude(&name_str, true) {
                continue;
            }
            count += copy_skill_dir(&entry.path(), &dst.join(&name))?;
        } else {
            if should_exclude(&name_str, false) {
                continue;
            }
            std::fs::copy(entry.path(), dst.join(&name))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Find the local source directory for a skill by name.
fn find_skill_source(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let claude_path = home.join(".claude").join("skills").join(name);
    if claude_path.is_dir() {
        return Some(claude_path);
    }
    let copilot_path = home.join(".copilot").join("skills").join(name);
    if copilot_path.is_dir() {
        return Some(copilot_path);
    }
    None
}

/// Local skills install directory (Claude convention).
fn local_skills_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("skills"))
}

// ---------------------------------------------------------------------------
// Core sync operations
// ---------------------------------------------------------------------------

struct PushResult {
    pushed_skills: usize,
    pushed_files: u64,
}

/// Execute a push: clone repo, copy local skill files + metadata, commit, push.
async fn do_push(
    token: &str,
    repo: &str,
    device_id: &str,
    skills: &[MySkill],
) -> Result<PushResult, String> {
    let tmp = tempfile::tempdir().map_err(|e| format!("tempdir: {e}"))?;
    let repo_dir = tmp.path().join("repo");

    clone_repo(token, repo, &repo_dir).await?;

    // Configure git user
    run_git_bare(&repo_dir, &["config", "user.name", "Pawscope"]).await?;
    run_git_bare(&repo_dir, &["config", "user.email", "pawscope@local"]).await?;

    // Clear existing skills/ directory
    let skills_dir = repo_dir.join("skills");
    if skills_dir.exists() {
        std::fs::remove_dir_all(&skills_dir).map_err(|e| format!("rm skills/: {e}"))?;
    }
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("mkdir skills/: {e}"))?;

    // Copy each skill
    let mut pushed_skills = 0usize;
    let mut pushed_files = 0u64;

    for skill in skills {
        if !is_valid_skill_name(&skill.name) {
            tracing::warn!("skipping skill with invalid name: {:?}", skill.name);
            continue;
        }
        if let Some(src) = find_skill_source(&skill.name) {
            let dst = skills_dir.join(&skill.name);
            match copy_skill_dir(&src, &dst) {
                Ok(n) => {
                    pushed_skills += 1;
                    pushed_files += n;
                }
                Err(e) => {
                    tracing::warn!("failed to copy skill {}: {e}", skill.name);
                }
            }
        }
    }

    // Write metadata JSON
    let envelope = SyncEnvelope {
        version: 1,
        updated_at: Utc::now(),
        device_id: device_id.to_string(),
        skills: skills.to_vec(),
    };
    let json = serde_json::to_string_pretty(&envelope).unwrap_or_default();
    std::fs::write(repo_dir.join("pawscope-my-skills.json"), &json)
        .map_err(|e| format!("write metadata: {e}"))?;

    // Stage all changes
    run_git_bare(&repo_dir, &["add", "-A"]).await?;

    // Check for changes
    let status = run_git_bare(&repo_dir, &["status", "--porcelain"]).await?;
    if status.trim().is_empty() {
        return Ok(PushResult {
            pushed_skills,
            pushed_files,
        });
    }

    // Commit and push
    let msg = format!("sync: update skills from {device_id}");
    run_git_bare(&repo_dir, &["commit", "-m", &msg]).await?;
    run_git(&repo_dir, token, &["push"]).await?;

    Ok(PushResult {
        pushed_skills,
        pushed_files,
    })
}

struct PullResult {
    pulled_skills: usize,
    merged_new: usize,
}

/// Execute a pull: clone repo, read metadata, copy remote skill files to local.
async fn do_pull(
    token: &str,
    repo: &str,
    local_skills: &[MySkill],
) -> Result<(PullResult, Vec<MySkill>), String> {
    let tmp = tempfile::tempdir().map_err(|e| format!("tempdir: {e}"))?;
    let repo_dir = tmp.path().join("repo");

    clone_repo(token, repo, &repo_dir).await?;

    // Read remote metadata
    let meta_path = repo_dir.join("pawscope-my-skills.json");
    let remote_skills: Vec<MySkill> = if meta_path.exists() {
        let raw = std::fs::read_to_string(&meta_path)
            .map_err(|e| format!("read metadata: {e}"))?;
        let envelope: SyncEnvelope = serde_json::from_str(&raw)
            .map_err(|e| format!("parse metadata: {e}"))?;
        envelope.skills
    } else {
        Vec::new()
    };

    // Merge: local wins for same id
    let local_ids: HashSet<String> = local_skills.iter().map(|s| s.id.clone()).collect();
    let mut merged = local_skills.to_vec();
    let mut merged_new = 0usize;
    for remote_skill in &remote_skills {
        if !local_ids.contains(&remote_skill.id) {
            merged.push(remote_skill.clone());
            merged_new += 1;
        }
    }

    // Copy remote skill files to local
    let remote_skills_dir = repo_dir.join("skills");
    let mut pulled_skills = 0usize;

    if remote_skills_dir.is_dir() {
        let local_base = local_skills_dir()
            .ok_or_else(|| "cannot determine home directory".to_string())?;

        if let Ok(entries) = std::fs::read_dir(&remote_skills_dir) {
            for entry in entries.flatten() {
                let ft = entry.file_type().unwrap_or_else(|_| {
                    // fallback: treat as file to skip
                    std::fs::metadata(entry.path())
                        .map(|m| m.file_type())
                        .unwrap_or_else(|_| entry.file_type().unwrap())
                });
                if !ft.is_dir() {
                    continue;
                }
                if ft.is_symlink() {
                    continue;
                }

                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !is_valid_skill_name(&name_str) {
                    tracing::warn!("skipping remote skill with invalid name: {name_str}");
                    continue;
                }

                let dst = local_base.join(&*name_str);
                match copy_skill_dir(&entry.path(), &dst) {
                    Ok(_) => {
                        pulled_skills += 1;
                    }
                    Err(e) => {
                        tracing::warn!("failed to pull skill {name_str}: {e}");
                    }
                }
            }
        }
    }

    Ok((
        PullResult {
            pulled_skills,
            merged_new,
        },
        merged,
    ))
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async fn github_api_get(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<serde_json::Value, String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Pawscope")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API {status}: {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse GitHub JSON: {e}"))
}

/// Extract the `description:` field from SKILL.md YAML front matter.
fn extract_description_from_frontmatter(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return String::new();
    }
    // Find the closing ---
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let front = &rest[..end];
            for line in front.lines() {
                let line = line.trim();
                if let Some(desc) = line.strip_prefix("description:") {
                    let desc = desc.trim();
                    // Remove surrounding quotes if present
                    let desc = desc
                        .strip_prefix('"')
                        .and_then(|d| d.strip_suffix('"'))
                        .or_else(|| desc.strip_prefix('\'').and_then(|d| d.strip_suffix('\'')))
                        .unwrap_or(desc);
                    return desc.to_string();
                }
            }
        }
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Remote skills listing
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct RemoteSkillEntry {
    name: String,
    description: String,
    installed: bool,
}

/// GET /api/sync/remote-skills
pub async fn remote_skills(State(s): State<AppState>) -> impl IntoResponse {
    let auth = s.auth.snapshot().await;
    if auth.github_token.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Not logged in"})),
        )
            .into_response();
    }

    let client = reqwest::Client::new();
    let repo = &auth.sync_repo;
    let token = &auth.github_token;

    // Try to get the default branch first
    let branch = match github_api_get(&client, &format!("https://api.github.com/repos/{repo}"), token).await {
        Ok(repo_json) => repo_json["default_branch"]
            .as_str()
            .unwrap_or("main")
            .to_string(),
        Err(_) => "main".to_string(),
    };

    // Get the repo tree
    let tree_url = format!(
        "https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=true"
    );
    let tree_json = match github_api_get(&client, &tree_url, token).await {
        Ok(v) => v,
        Err(_) => {
            // Empty repo or other error — return empty list
            return Json(serde_json::json!({"skills": []})).into_response();
        }
    };

    let tree = match tree_json["tree"].as_array() {
        Some(arr) => arr,
        None => {
            return Json(serde_json::json!({"skills": []})).into_response();
        }
    };

    // Find entries matching skills/{name}/SKILL.md
    let skill_md_re = regex::Regex::new(r"^skills/([^/]+)/SKILL\.md$").unwrap();
    let mut skill_names: Vec<String> = Vec::new();
    for entry in tree {
        if let Some(path) = entry["path"].as_str() {
            if let Some(caps) = skill_md_re.captures(path) {
                if let Some(name) = caps.get(1) {
                    let name = name.as_str().to_string();
                    if is_valid_skill_name(&name) {
                        skill_names.push(name);
                    }
                }
            }
        }
    }

    // Determine which skills are installed locally
    let home = dirs::home_dir().unwrap_or_default();
    let local_skills_base = home.join(".claude").join("skills");

    // Fetch descriptions in parallel (limited concurrency)
    let mut entries: Vec<RemoteSkillEntry> = Vec::new();
    for name in &skill_names {
        let contents_url = format!(
            "https://api.github.com/repos/{repo}/contents/skills/{name}/SKILL.md?ref={branch}"
        );
        let description = match github_api_get(&client, &contents_url, token).await {
            Ok(content_json) => {
                // Content is base64 encoded
                if let Some(b64) = content_json["content"].as_str() {
                    let cleaned: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
                    match B64.decode(&cleaned) {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            extract_description_from_frontmatter(&text)
                        }
                        Err(_) => String::new(),
                    }
                } else {
                    String::new()
                }
            }
            Err(_) => String::new(),
        };

        let installed = local_skills_base.join(name).is_dir();
        entries.push(RemoteSkillEntry {
            name: name.clone(),
            description,
            installed,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    Json(serde_json::json!({"skills": entries})).into_response()
}

// ---------------------------------------------------------------------------
// Install skill from remote
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct InstallSkillBody {
    pub skill_name: String,
    pub target: String,           // "global" or "project"
    pub project_path: Option<String>,
}

/// POST /api/skills/install
pub async fn install_skill(
    State(s): State<AppState>,
    Json(body): Json<InstallSkillBody>,
) -> impl IntoResponse {
    let auth = s.auth.snapshot().await;
    if auth.github_token.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Not logged in"})),
        )
            .into_response();
    }

    if !is_valid_skill_name(&body.skill_name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid skill name"})),
        )
            .into_response();
    }

    // Determine install target directory
    let install_dir = match body.target.as_str() {
        "global" => {
            let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string());
            match home {
                Ok(h) => h.join(".claude").join("skills").join(&body.skill_name),
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": e})),
                    )
                        .into_response();
                }
            }
        }
        "project" => {
            let project_path = match &body.project_path {
                Some(p) => p.clone(),
                None => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "project_path required for project install"})),
                    )
                        .into_response();
                }
            };
            if project_path.contains("..") {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Invalid project path"})),
                )
                    .into_response();
            }
            let pp = PathBuf::from(&project_path);
            if !pp.is_dir() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Project path does not exist or is not a directory"})),
                )
                    .into_response();
            }
            pp.join(".claude").join("skills").join(&body.skill_name)
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "target must be 'global' or 'project'"})),
            )
                .into_response();
        }
    };

    // Clone the sync repo
    let tmp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("tempdir: {e}")})),
            )
                .into_response();
        }
    };
    let repo_dir = tmp.path().join("repo");

    if let Err(e) = clone_repo(&auth.github_token, &auth.sync_repo, &repo_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response();
    }

    // Find the skill in the cloned repo
    let skill_src = repo_dir.join("skills").join(&body.skill_name);
    if !skill_src.is_dir() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": format!("Skill '{}' not found in remote repo", body.skill_name)})),
        )
            .into_response();
    }

    // Copy skill to target
    match copy_skill_dir(&skill_src, &install_dir) {
        Ok(files) => {
            Json(serde_json::json!({
                "ok": true,
                "installed_to": install_dir.display().to_string(),
                "files": files,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Copy failed: {e}")})),
        )
            .into_response(),
    }
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

    let skills_data = s.my_skills.snapshot().await;

    match do_push(
        &auth.github_token,
        &auth.sync_repo,
        &auth.device_id,
        &skills_data.skills,
    )
    .await
    {
        Ok(result) => {
            let _ = s.auth.update_last_sync().await;
            Json(serde_json::json!({
                "ok": true,
                "pushed_skills": result.pushed_skills,
                "pushed_files": result.pushed_files,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
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

    let local_skills = s.my_skills.snapshot().await;

    match do_pull(&auth.github_token, &auth.sync_repo, &local_skills.skills).await {
        Ok((result, merged)) => {
            if result.merged_new > 0 {
                if let Err(e) = s.my_skills.replace_all(merged).await {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": e.to_string()})),
                    )
                        .into_response();
                }
            }

            let _ = s.auth.update_last_sync().await;
            Json(serde_json::json!({
                "ok": true,
                "pulled_skills": result.pulled_skills,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
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

    let local_skills = s.my_skills.snapshot().await;

    // --- Pull phase ---
    let (pull_result, merged) =
        match do_pull(&auth.github_token, &auth.sync_repo, &local_skills.skills).await {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e})),
                )
                    .into_response();
            }
        };

    // Persist merged metadata
    if pull_result.merged_new > 0 {
        if let Err(e) = s.my_skills.replace_all(merged).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    }

    // --- Push phase (re-read after merge) ---
    let skills_data = s.my_skills.snapshot().await;

    let push_result = match do_push(
        &auth.github_token,
        &auth.sync_repo,
        &auth.device_id,
        &skills_data.skills,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };

    let _ = s.auth.update_last_sync().await;

    Json(serde_json::json!({
        "ok": true,
        "pulled_skills": pull_result.pulled_skills,
        "pushed_skills": push_result.pushed_skills,
        "pushed_files": push_result.pushed_files,
    }))
    .into_response()
}
