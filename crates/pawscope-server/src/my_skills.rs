use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub origin_kind: String,
    pub origin_key: String,
    #[serde(default)]
    pub category: String,
    pub added_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MySkillsData {
    pub skills: Vec<MySkill>,
}

// ---------------------------------------------------------------------------
// Store — follows labels.rs pattern
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct MySkillsStore {
    path: PathBuf,
    inner: Arc<RwLock<MySkillsData>>,
}

fn default_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pawscope")
        .join("my-skills.json")
}

impl MySkillsStore {
    pub async fn load() -> Self {
        Self::load_from(default_path()).await
    }

    pub async fn load_from(path: PathBuf) -> Self {
        let data = tokio::fs::read_to_string(&path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<MySkillsData>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Arc::new(RwLock::new(data)),
        }
    }

    pub async fn snapshot(&self) -> MySkillsData {
        self.inner.read().await.clone()
    }

    pub async fn add(&self, skill: MySkill) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            if g.skills
                .iter()
                .any(|s| s.origin_kind == skill.origin_kind && s.origin_key == skill.origin_key)
            {
                return Ok(());
            }
            g.skills.push(skill);
        }
        self.persist().await
    }

    pub async fn remove(&self, id: &str) -> std::io::Result<bool> {
        let removed;
        {
            let mut g = self.inner.write().await;
            let before = g.skills.len();
            g.skills.retain(|s| s.id != id);
            removed = g.skills.len() < before;
        }
        if removed {
            self.persist().await?;
        }
        Ok(removed)
    }

    pub async fn update(
        &self,
        id: &str,
        category: Option<String>,
        sort_order: Option<i32>,
    ) -> std::io::Result<bool> {
        let found;
        {
            let mut g = self.inner.write().await;
            found = if let Some(s) = g.skills.iter_mut().find(|s| s.id == id) {
                let mut changed = false;
                if let Some(c) = category {
                    s.category = c;
                    changed = true;
                }
                if let Some(o) = sort_order {
                    s.sort_order = o;
                    changed = true;
                }
                if changed {
                    s.updated_at = Utc::now();
                }
                true
            } else {
                false
            };
        }
        if found {
            self.persist().await?;
        }
        Ok(found)
    }

    pub async fn replace_all(&self, skills: Vec<MySkill>) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            g.skills = skills;
        }
        self.persist().await
    }

    pub async fn reorder(&self, ids: &[String]) -> std::io::Result<()> {
        {
            let mut g = self.inner.write().await;
            for (i, id) in ids.iter().enumerate() {
                if let Some(s) = g.skills.iter_mut().find(|s| &s.id == id) {
                    s.sort_order = i as i32;
                }
            }
        }
        self.persist().await
    }

    async fn persist(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let snap = self.inner.read().await;
        let body = serde_json::to_string_pretty(&*snap).map_err(std::io::Error::other)?;
        tokio::fs::write(&self.path, body).await
    }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct MySkillResponse {
    id: String,
    name: String,
    description: String,
    origin_kind: String,
    origin_key: String,
    category: String,
    added_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    sort_order: i32,
    missing: bool,
}

#[derive(Serialize)]
struct MySkillsListResponse {
    skills: Vec<MySkillResponse>,
    total: usize,
    categories: Vec<String>,
}

/// GET /api/my-skills
pub async fn list_my_skills(State(s): State<AppState>) -> impl IntoResponse {
    let data = s.my_skills.snapshot().await;
    let mut categories: Vec<String> = data
        .skills
        .iter()
        .filter(|s| !s.category.is_empty())
        .map(|s| s.category.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    categories.sort();

    let skills: Vec<MySkillResponse> = data
        .skills
        .iter()
        .map(|s| MySkillResponse {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone(),
            origin_kind: s.origin_kind.clone(),
            origin_key: s.origin_key.clone(),
            category: s.category.clone(),
            added_at: s.added_at,
            updated_at: s.updated_at,
            sort_order: s.sort_order,
            missing: false,
        })
        .collect();
    let total = skills.len();
    Json(MySkillsListResponse {
        skills,
        total,
        categories,
    })
    .into_response()
}

/// POST /api/my-skills
#[derive(Deserialize)]
pub struct AddMySkillBody {
    pub origin_kind: String,
    pub origin_key: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
}

pub async fn add_my_skill(
    State(s): State<AppState>,
    Json(body): Json<AddMySkillBody>,
) -> impl IntoResponse {
    if body.origin_kind != "store" && body.origin_kind != "filesystem" {
        return (
            StatusCode::BAD_REQUEST,
            "origin_kind must be 'store' or 'filesystem'",
        )
            .into_response();
    }
    if body.origin_key.is_empty() {
        return (StatusCode::BAD_REQUEST, "origin_key is required").into_response();
    }

    let id = format!("{}", uuid::Uuid::new_v4());
    let now = Utc::now();
    let skill = MySkill {
        id: id.clone(),
        name: if body.name.is_empty() {
            body.origin_key
                .split('/')
                .next_back()
                .unwrap_or(&body.origin_key)
                .to_string()
        } else {
            body.name
        },
        description: body.description,
        origin_kind: body.origin_kind,
        origin_key: body.origin_key,
        category: body.category,
        added_at: now,
        updated_at: now,
        sort_order: 0,
    };
    match s.my_skills.add(skill).await {
        Ok(()) => Json(serde_json::json!({"id": id, "added": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// DELETE /api/my-skills/{id}
pub async fn remove_my_skill(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    match s.my_skills.remove(&id).await {
        Ok(true) => Json(serde_json::json!({"removed": true})).into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "skill not found").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// PATCH /api/my-skills/{id}
#[derive(Deserialize)]
pub struct UpdateMySkillBody {
    pub category: Option<String>,
    pub sort_order: Option<i32>,
}

pub async fn update_my_skill(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Json(body): Json<UpdateMySkillBody>,
) -> impl IntoResponse {
    match s
        .my_skills
        .update(&id, body.category, body.sort_order)
        .await
    {
        Ok(true) => Json(serde_json::json!({"updated": true})).into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "skill not found").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Auto-categorization
// ---------------------------------------------------------------------------

fn classify_skill(name: &str, description: &str) -> &'static str {
    let n = name.to_lowercase();
    let d = description.to_lowercase();
    let text = format!("{} {}", n, d);

    // Social media publishing
    if n.contains("post-to")
        || n.contains("wechat")
        || n.contains("weibo")
        || n.contains("xiaohongshu")
        || n.contains("x-to-")
        || n.contains("twitter")
        || text.contains("发布")
        || text.contains("publish to")
    {
        return "📱 社交媒体";
    }
    // Image / visual design
    if n.contains("image")
        || n.contains("cover")
        || n.contains("comic")
        || n.contains("infographic")
        || n.contains("illustrat")
        || n.contains("slide")
        || n.contains("card")
        || n.contains("diagram")
        || (text.contains("visual") && !text.contains("visual studio"))
    {
        return "🎨 图片设计";
    }
    // Content writing / creation
    if n.contains("writ")
        || n.contains("article")
        || text.contains("write article")
        || text.contains("blog")
        || text.contains("tutorial")
        || text.contains("newsletter")
    {
        return "📝 内容创作";
    }
    // Translation
    if n.contains("translat") || text.contains("翻译") {
        return "🌐 翻译";
    }
    // Content processing / conversion
    if n.contains("format")
        || n.contains("markdown")
        || n.contains("html")
        || n.contains("convert")
        || n.contains("url-to")
    {
        return "🔄 内容处理";
    }
    // Document processing
    if n.contains("pdf") || text.contains("document") || text.contains("文档") {
        return "📄 文档处理";
    }
    // Development tools
    if n.contains("comment")
        || n.contains("governance")
        || n.contains("owasp")
        || n.contains("security")
        || n.contains("debug")
        || n.contains("lint")
        || n.contains("review")
        || n.contains("refactor")
        || n.contains("test")
        || text.contains("code quality")
        || text.contains("compliance")
    {
        return "🛠️ 开发工具";
    }
    // Automation / workflow
    if n.contains("daily")
        || n.contains("auto")
        || n.contains("insight")
        || n.contains("cron")
        || n.contains("schedule")
        || text.contains("automat")
        || text.contains("workflow")
    {
        return "🤖 自动化";
    }
    "📦 其他"
}

/// POST /api/my-skills/auto-categorize
#[derive(Deserialize)]
pub struct AutoCategorizeBody {
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Serialize)]
struct AutoCategorizeResponse {
    categorized: usize,
    skipped: usize,
    categories: std::collections::BTreeMap<String, usize>,
}

pub async fn auto_categorize(
    State(s): State<AppState>,
    Json(body): Json<AutoCategorizeBody>,
) -> impl IntoResponse {
    let data = s.my_skills.snapshot().await;
    let mut updated = data.skills.clone();
    let mut categorized = 0usize;
    let mut skipped = 0usize;

    for skill in &mut updated {
        if !body.overwrite && !skill.category.is_empty() {
            skipped += 1;
            continue;
        }
        let new_cat = classify_skill(&skill.name, &skill.description);
        if skill.category != new_cat {
            skill.category = new_cat.to_string();
            skill.updated_at = Utc::now();
            categorized += 1;
        } else {
            skipped += 1;
        }
    }

    let mut cat_counts = std::collections::BTreeMap::new();
    for skill in &updated {
        if !skill.category.is_empty() {
            *cat_counts.entry(skill.category.clone()).or_insert(0usize) += 1;
        }
    }

    if categorized > 0 {
        if let Err(e) = s.my_skills.replace_all(updated).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    }

    Json(AutoCategorizeResponse {
        categorized,
        skipped,
        categories: cat_counts,
    })
    .into_response()
}

/// POST /api/my-skills/reorder
#[derive(Deserialize)]
pub struct ReorderBody {
    pub ids: Vec<String>,
}

pub async fn reorder_my_skills(
    State(s): State<AppState>,
    Json(body): Json<ReorderBody>,
) -> impl IntoResponse {
    match s.my_skills.reorder(&body.ids).await {
        Ok(()) => Json(serde_json::json!({"reordered": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
