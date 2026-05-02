use crate::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreSkill {
    pub name: String,
    pub description: String,
    pub assets: Vec<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreCatalog {
    pub skills: Vec<StoreSkill>,
    pub total: usize,
    pub source: String,
    pub last_updated: Option<String>,
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetail {
    pub name: String,
    pub description: String,
    pub content: String,
    pub files: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct InstallRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct InstallResponse {
    pub installed: bool,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct UninstallResponse {
    pub uninstalled: bool,
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedCatalog {
    skills: Vec<SkillEntry>,
    fetched_at: String,
    commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkillEntry {
    name: String,
    description: String,
    assets: Vec<String>,
}

static CATALOG_CACHE: OnceLock<RwLock<Option<CachedCatalog>>> = OnceLock::new();

fn cache_lock() -> &'static RwLock<Option<CachedCatalog>> {
    CATALOG_CACHE.get_or_init(|| RwLock::new(None))
}

fn cache_file_path() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".pawscope");
    Some(dir.join("store-cache.json"))
}

fn load_disk_cache() -> Option<CachedCatalog> {
    let path = cache_file_path()?;
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_disk_cache(catalog: &CachedCatalog) {
    if let Some(path) = cache_file_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, serde_json::to_string_pretty(catalog).unwrap_or_default());
    }
}

fn is_cache_fresh(catalog: &CachedCatalog) -> bool {
    if let Ok(fetched) = chrono::DateTime::parse_from_rfc3339(&catalog.fetched_at) {
        let age = chrono::Utc::now().signed_duration_since(fetched);
        return age.num_hours() < 24;
    }
    false
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Pawscope/1.1")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap()
    })
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

fn parse_skills_index(md: &str) -> Vec<SkillEntry> {
    let mut skills = Vec::new();
    let re = Regex::new(
        r#"^\| \[([^\]]+)\]\([^\)]+\)(?:<br />.*?)? \| (.*?) \| (.*?) \|$"#,
    )
    .unwrap();
    for line in md.lines() {
        if let Some(caps) = re.captures(line.trim()) {
            let name = caps[1].to_string();
            let desc = caps[2].replace("<br />", " ").trim().to_string();
            let assets_raw = caps[3].trim();
            let assets: Vec<String> = if assets_raw == "None" || assets_raw.is_empty() {
                vec![]
            } else {
                assets_raw
                    .split("<br />")
                    .map(|s| s.trim().trim_matches('`').to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            };
            skills.push(SkillEntry {
                name,
                description: desc,
                assets,
            });
        }
    }
    skills
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn skills_dir() -> Option<std::path::PathBuf> {
    Some(dirs::home_dir()?.join(".copilot").join("skills"))
}

fn is_installed(name: &str) -> bool {
    skills_dir()
        .map(|d| d.join(name).join("SKILL.md").exists())
        .unwrap_or(false)
}

fn validate_skill_name(name: &str) -> bool {
    let re = Regex::new(r"^[a-z0-9-]+$").unwrap();
    re.is_match(name) && !name.contains("..")
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/store/catalog
pub async fn store_catalog(State(_s): State<AppState>) -> impl IntoResponse {
    // 1. Try in-memory cache
    {
        let guard = cache_lock().read().await;
        if let Some(ref cached) = *guard {
            if is_cache_fresh(cached) {
                let skills: Vec<StoreSkill> = cached
                    .skills
                    .iter()
                    .map(|e| StoreSkill {
                        name: e.name.clone(),
                        description: e.description.clone(),
                        assets: e.assets.clone(),
                        installed: is_installed(&e.name),
                    })
                    .collect();
                let total = skills.len();
                return Json(StoreCatalog {
                    skills,
                    total,
                    source: "github/awesome-copilot".into(),
                    last_updated: Some(cached.fetched_at.clone()),
                    commit_sha: cached.commit_sha.clone(),
                })
                .into_response();
            }
        }
    }

    // 2. Try disk cache
    if let Some(disk) = load_disk_cache() {
        if is_cache_fresh(&disk) {
            let skills: Vec<StoreSkill> = disk
                .skills
                .iter()
                .map(|e| StoreSkill {
                    name: e.name.clone(),
                    description: e.description.clone(),
                    assets: e.assets.clone(),
                    installed: is_installed(&e.name),
                })
                .collect();
            let total = skills.len();
            // populate in-memory
            {
                let mut guard = cache_lock().write().await;
                *guard = Some(disk.clone());
            }
            return Json(StoreCatalog {
                skills,
                total,
                source: "github/awesome-copilot".into(),
                last_updated: Some(disk.fetched_at.clone()),
                commit_sha: disk.commit_sha.clone(),
            })
            .into_response();
        }
    }

    // 3. Fetch from GitHub
    let client = http_client();
    let md_url =
        "https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.skills.md";
    let md_resp = match client.get(md_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("fetch index: {e}")).into_response();
        }
    };
    let md_text = match md_resp.text().await {
        Ok(t) => t,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("read index: {e}")).into_response();
        }
    };

    let entries = parse_skills_index(&md_text);

    // Fetch commit SHA (best-effort)
    let sha: Option<String> = client
        .get("https://api.github.com/repos/github/awesome-copilot/commits/main")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .ok()
        .and_then(|r| {
            futures::executor::block_on(async {
                r.json::<serde_json::Value>().await.ok()
            })
        })
        .and_then(|v| v.get("sha")?.as_str().map(String::from));

    let now = chrono::Utc::now().to_rfc3339();
    let cached = CachedCatalog {
        skills: entries.clone(),
        fetched_at: now.clone(),
        commit_sha: sha.clone(),
    };

    // Save
    save_disk_cache(&cached);
    {
        let mut guard = cache_lock().write().await;
        *guard = Some(cached);
    }

    let skills: Vec<StoreSkill> = entries
        .iter()
        .map(|e| StoreSkill {
            name: e.name.clone(),
            description: e.description.clone(),
            assets: e.assets.clone(),
            installed: is_installed(&e.name),
        })
        .collect();
    let total = skills.len();

    Json(StoreCatalog {
        skills,
        total,
        source: "github/awesome-copilot".into(),
        last_updated: Some(now),
        commit_sha: sha,
    })
    .into_response()
}

/// GET /api/store/skill/{name}
pub async fn store_skill_detail(
    Path(name): Path<String>,
    State(_s): State<AppState>,
) -> impl IntoResponse {
    if !validate_skill_name(&name) {
        return (StatusCode::BAD_REQUEST, "invalid skill name").into_response();
    }

    let client = http_client();

    // Fetch SKILL.md
    let skill_url = format!(
        "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/{}/SKILL.md",
        name
    );
    let content = match client.get(&skill_url).send().await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        Ok(r) => {
            return (
                StatusCode::NOT_FOUND,
                format!("skill not found: {}", r.status()),
            )
                .into_response();
        }
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("fetch skill: {e}")).into_response();
        }
    };

    // Fetch directory listing
    let dir_url = format!(
        "https://api.github.com/repos/github/awesome-copilot/contents/skills/{}",
        name
    );
    let files: Vec<String> = match client
        .get(&dir_url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let arr: Vec<serde_json::Value> = r.json().await.unwrap_or_default();
            arr.iter()
                .filter_map(|v| v.get("name")?.as_str().map(String::from))
                .collect()
        }
        _ => vec![],
    };

    // Get description from cache
    let description = {
        let guard = cache_lock().read().await;
        guard
            .as_ref()
            .and_then(|c| c.skills.iter().find(|s| s.name == name))
            .map(|s| s.description.clone())
            .unwrap_or_default()
    };

    Json(SkillDetail {
        name,
        description,
        content,
        files,
    })
    .into_response()
}

/// POST /api/store/install
pub async fn store_install(
    State(_s): State<AppState>,
    Json(req): Json<InstallRequest>,
) -> impl IntoResponse {
    if !validate_skill_name(&req.name) {
        return (StatusCode::BAD_REQUEST, "invalid skill name").into_response();
    }

    let base_dir = match skills_dir() {
        Some(d) => d,
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot resolve home dir").into_response();
        }
    };
    let skill_dir = base_dir.join(&req.name);
    let _ = std::fs::create_dir_all(&skill_dir);

    let client = http_client();

    // Fetch directory listing to discover files
    let dir_url = format!(
        "https://api.github.com/repos/github/awesome-copilot/contents/skills/{}",
        req.name
    );
    let file_list: Vec<(String, String)> = match client
        .get(&dir_url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let arr: Vec<serde_json::Value> = r.json().await.unwrap_or_default();
            arr.iter()
                .filter_map(|v| {
                    let name = v.get("name")?.as_str()?.to_string();
                    let download = v.get("download_url")?.as_str()?.to_string();
                    Some((name, download))
                })
                .collect()
        }
        Ok(r) => {
            return (
                StatusCode::NOT_FOUND,
                format!("skill not found: {}", r.status()),
            )
                .into_response();
        }
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("list files: {e}")).into_response();
        }
    };

    // Download each file
    for (fname, url) in &file_list {
        match client.get(url).send().await {
            Ok(r) if r.status().is_success() => {
                let bytes = r.bytes().await.unwrap_or_default();
                let dest = skill_dir.join(fname);
                if let Err(e) = std::fs::write(&dest, &bytes) {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("write {}: {e}", fname),
                    )
                        .into_response();
                }
            }
            _ => {
                tracing::warn!("failed to download {}", url);
            }
        }
    }

    // Write manifest
    let sha = {
        let guard = cache_lock().read().await;
        guard
            .as_ref()
            .and_then(|c| c.commit_sha.clone())
    };
    let manifest = serde_json::json!({
        "source": "github/awesome-copilot",
        "installed_at": chrono::Utc::now().to_rfc3339(),
        "commit_sha": sha,
    });
    let _ = std::fs::write(
        skill_dir.join(".pawscope-manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    );

    let path_str = skill_dir.to_string_lossy().to_string();
    Json(InstallResponse {
        installed: true,
        path: path_str,
    })
    .into_response()
}

/// POST /api/store/uninstall
pub async fn store_uninstall(
    State(_s): State<AppState>,
    Json(req): Json<InstallRequest>,
) -> impl IntoResponse {
    if !validate_skill_name(&req.name) {
        return (StatusCode::BAD_REQUEST, "invalid skill name").into_response();
    }

    let base_dir = match skills_dir() {
        Some(d) => d,
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot resolve home dir").into_response();
        }
    };
    let skill_dir = base_dir.join(&req.name);

    if skill_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&skill_dir) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("remove: {e}"),
            )
                .into_response();
        }
    }

    Json(UninstallResponse { uninstalled: true }).into_response()
}

/// POST /api/store/refresh
pub async fn store_refresh(State(_s): State<AppState>) -> impl IntoResponse {
    let mut guard = cache_lock().write().await;
    *guard = None;
    StatusCode::OK
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_index_extracts_skills() {
        let md = r#"
| Skill | Description | Assets |
| --- | --- | --- |
| [my-skill](../skills/my-skill/SKILL.md)<br />`gh skills install github/awesome-copilot my-skill` | Does cool stuff | `assets/file1`<br />`references/file2` |
| [another](../skills/another/SKILL.md)<br />`gh skills install github/awesome-copilot another` | Another desc | None |
"#;
        let skills = parse_skills_index(md);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "my-skill");
        assert_eq!(skills[0].description, "Does cool stuff");
        assert_eq!(skills[0].assets, vec!["assets/file1", "references/file2"]);
        assert_eq!(skills[1].name, "another");
        assert_eq!(skills[1].description, "Another desc");
        assert!(skills[1].assets.is_empty());
    }

    #[test]
    fn validate_names() {
        assert!(validate_skill_name("my-skill"));
        assert!(validate_skill_name("abc123"));
        assert!(!validate_skill_name("My-Skill"));
        assert!(!validate_skill_name("../bad"));
        assert!(!validate_skill_name("a/b"));
        assert!(!validate_skill_name(""));
    }
}
