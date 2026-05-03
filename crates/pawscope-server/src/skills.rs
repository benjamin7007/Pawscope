use crate::AppState;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub invocations: u64,
}

#[derive(Serialize)]
pub struct SkillsResponse {
    pub skills: Vec<SkillEntry>,
    pub total: usize,
    pub by_source: HashMap<String, usize>,
}

pub async fn list_skills(State(state): State<AppState>) -> Json<SkillsResponse> {
    // Aggregate invocation counts from all sessions, and collect distinct
    // session cwds to discover project-local skills (any cwd containing a
    // `.github/skills/` directory contributes that root under the
    // `project-skills` source).
    let mut invocations: HashMap<String, u64> = HashMap::new();
    let mut project_skill_roots: Vec<PathBuf> = Vec::new();
    let mut seen_roots: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    if let Ok(metas) = state.adapter.list_sessions().await {
        for m in &metas {
            if let Ok(d) = state.adapter.get_detail(&m.id).await {
                for k in d.skills_invoked {
                    *invocations.entry(k).or_default() += 1;
                }
            }
            let candidate = m.cwd.join(".github").join("skills");
            if candidate.is_dir() {
                let canon = candidate.canonicalize().unwrap_or(candidate);
                if seen_roots.insert(canon.clone()) {
                    project_skill_roots.push(canon);
                }
            }
        }
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let mut sources: Vec<(String, PathBuf)> = vec![
        (
            "copilot-superpowers".to_string(),
            PathBuf::from(format!("{home}/.copilot/installed-plugins")),
        ),
        (
            "claude-skills".to_string(),
            PathBuf::from(format!("{home}/.claude/skills")),
        ),
        (
            "agents-skills".to_string(),
            PathBuf::from(format!("{home}/.agents/skills")),
        ),
    ];
    for root in project_skill_roots {
        sources.push(("project-skills".to_string(), root));
    }

    let mut skills = Vec::new();
    let mut by_source: HashMap<String, usize> = HashMap::new();
    for (label, root) in &sources {
        let mut found = scan_skills_recursive(root, label, 4);
        *by_source.entry(label.clone()).or_default() += found.len();
        skills.append(&mut found);
    }

    // Attach invocation counts.
    for s in &mut skills {
        s.invocations = invocations.get(&s.name).copied().unwrap_or(0);
    }
    skills.sort_by(|a, b| {
        b.invocations
            .cmp(&a.invocations)
            .then_with(|| a.name.cmp(&b.name))
    });

    let total = skills.len();
    Json(SkillsResponse {
        skills,
        total,
        by_source,
    })
}

fn scan_skills_recursive(root: &Path, source: &str, max_depth: usize) -> Vec<SkillEntry> {
    let mut out = Vec::new();
    if max_depth == 0 || !root.is_dir() {
        return out;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let skill_md = p.join("SKILL.md");
            if skill_md.is_file() {
                if let Some(s) = parse_skill_md(&skill_md, source) {
                    out.push(s);
                }
            } else {
                // Recurse to find nested skills/ directories (e.g. plugins/*/skills/*/SKILL.md)
                out.extend(scan_skills_recursive(&p, source, max_depth - 1));
            }
        }
    }
    out
}

fn parse_skill_md(path: &Path, source: &str) -> Option<SkillEntry> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut name = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let mut description = String::new();

    // Parse YAML frontmatter delimited by leading `---` lines.
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Some(SkillEntry {
            name,
            description,
            source: source.to_string(),
            path: path.display().to_string(),
            invocations: 0,
        });
    }
    let mut current_key: Option<String> = None;
    let mut buf = String::new();
    for line in lines.by_ref() {
        if line == "---" {
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            // Continuation of previous key (e.g. folded scalar).
            if current_key.as_deref() == Some("description") {
                if !buf.is_empty() {
                    buf.push(' ');
                }
                buf.push_str(line.trim());
            }
        } else if let Some((k, v)) = line.split_once(':') {
            // Flush previous description buffer.
            if current_key.as_deref() == Some("description") && !buf.is_empty() {
                description = buf.clone();
                buf.clear();
            }
            let key = k.trim().to_string();
            let value = v.trim().trim_start_matches('>').trim().to_string();
            match key.as_str() {
                "name" => {
                    if !value.is_empty() {
                        name = value;
                    }
                    current_key = Some("name".to_string());
                }
                "description" => {
                    if !value.is_empty() {
                        description = value;
                        current_key = Some("description-done".to_string());
                    } else {
                        current_key = Some("description".to_string());
                    }
                }
                _ => {
                    current_key = Some(key);
                }
            }
        }
    }
    if current_key.as_deref() == Some("description") && !buf.is_empty() {
        description = buf;
    }

    // Truncate overly long descriptions.
    if description.len() > 400 {
        let mut idx = 400;
        while !description.is_char_boundary(idx) && idx > 0 {
            idx -= 1;
        }
        description.truncate(idx);
        description.push('…');
    }

    Some(SkillEntry {
        name,
        description,
        source: source.to_string(),
        path: path.display().to_string(),
        invocations: 0,
    })
}

async fn discovered_project_skill_roots(state: &AppState) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    if let Ok(metas) = state.adapter.list_sessions().await {
        for m in &metas {
            let candidate = m.cwd.join(".github").join("skills");
            if candidate.is_dir() {
                let canon = candidate.canonicalize().unwrap_or(candidate);
                if seen.insert(canon.clone()) {
                    out.push(canon);
                }
            }
        }
    }
    out
}

fn skill_roots() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        PathBuf::from(format!("{home}/.copilot/installed-plugins")),
        PathBuf::from(format!("{home}/.claude/skills")),
        PathBuf::from(format!("{home}/.agents/skills")),
    ]
}

#[derive(Deserialize)]
pub struct ContentQuery {
    pub path: String,
}

#[derive(Serialize)]
pub struct SkillContent {
    pub path: String,
    pub content: String,
    pub bytes: usize,
}

#[derive(Serialize)]
pub struct SkillSession {
    pub id: String,
    pub agent: String,
    pub summary: String,
    pub repo: Option<String>,
    pub last_event_at: chrono::DateTime<chrono::Utc>,
    pub invocations: u32,
}

#[derive(Serialize)]
pub struct SkillCoOccurrence {
    pub name: String,
    pub sessions: u32,
}

#[derive(Serialize)]
pub struct SkillUsage {
    pub name: String,
    pub total_invocations: u32,
    pub session_count: usize,
    pub daily30: [u32; 30],
    pub daily365: Vec<u32>,
    pub cooccurring: Vec<SkillCoOccurrence>,
    pub sessions: Vec<SkillSession>,
}

#[derive(Deserialize)]
pub struct UsageQuery {
    pub name: String,
}

pub async fn skill_usage(
    State(state): State<AppState>,
    Query(q): Query<UsageQuery>,
) -> Result<Json<SkillUsage>, StatusCode> {
    let metas = state
        .adapter
        .list_sessions()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let now = chrono::Utc::now();
    let mut daily = [0u32; 30];
    let mut daily365 = vec![0u32; 365];
    let mut sessions: Vec<SkillSession> = Vec::new();
    let mut total = 0u32;
    let mut cooc: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    for m in &metas {
        let Ok(d) = state.adapter.get_detail(&m.id).await else {
            continue;
        };
        let count = d.skills_invoked.iter().filter(|n| **n == q.name).count() as u32;
        if count == 0 {
            continue;
        }
        total += count;

        let days_ago = (now.date_naive() - m.last_event_at.date_naive()).num_days();
        if (0..30).contains(&days_ago) {
            let idx = (29 - days_ago) as usize;
            daily[idx] = daily[idx].saturating_add(count);
        }
        if (0..365).contains(&days_ago) {
            let idx = (364 - days_ago) as usize;
            daily365[idx] = daily365[idx].saturating_add(count);
        }

        // Co-occurrence: every other unique skill in this session counts as 1.
        let mut seen = std::collections::HashSet::new();
        for n in &d.skills_invoked {
            if n != &q.name && seen.insert(n.clone()) {
                *cooc.entry(n.clone()).or_insert(0) += 1;
            }
        }

        sessions.push(SkillSession {
            id: m.id.clone(),
            agent: format!("{:?}", m.agent).to_lowercase(),
            summary: m.summary.clone(),
            repo: m.repo.clone(),
            last_event_at: m.last_event_at,
            invocations: count,
        });
    }
    sessions.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
    let session_count = sessions.len();

    let mut cooccurring: Vec<SkillCoOccurrence> = cooc
        .into_iter()
        .map(|(name, sessions)| SkillCoOccurrence { name, sessions })
        .collect();
    cooccurring.sort_by(|a, b| {
        b.sessions
            .cmp(&a.sessions)
            .then_with(|| a.name.cmp(&b.name))
    });
    cooccurring.truncate(12);

    Ok(Json(SkillUsage {
        name: q.name,
        total_invocations: total,
        session_count,
        daily30: daily,
        daily365,
        cooccurring,
        sessions,
    }))
}

pub async fn skill_content(
    State(state): State<AppState>,
    Query(q): Query<ContentQuery>,
) -> Result<Json<SkillContent>, StatusCode> {
    // Resolve and validate that the requested path lies under one of the
    // known skill root directories — never serve arbitrary files.
    let req = PathBuf::from(&q.path);
    let canonical = std::fs::canonicalize(&req).map_err(|_| StatusCode::NOT_FOUND)?;
    let mut roots: Vec<PathBuf> = skill_roots()
        .into_iter()
        .filter_map(|r| std::fs::canonicalize(&r).ok())
        .collect();
    roots.extend(discovered_project_skill_roots(&state).await);
    if !roots.iter().any(|r| canonical.starts_with(r)) {
        return Err(StatusCode::FORBIDDEN);
    }
    if canonical.file_name().and_then(|n| n.to_str()) != Some("SKILL.md") {
        return Err(StatusCode::FORBIDDEN);
    }
    let content = std::fs::read_to_string(&canonical).map_err(|_| StatusCode::NOT_FOUND)?;
    let bytes = content.len();
    // Cap response size to avoid pathological skills.
    let truncated = if bytes > 64 * 1024 {
        let mut idx = 64 * 1024;
        while !content.is_char_boundary(idx) && idx > 0 {
            idx -= 1;
        }
        let mut s = content[..idx].to_string();
        s.push_str("\n\n…(truncated)");
        s
    } else {
        content
    };
    Ok(Json(SkillContent {
        path: canonical.display().to_string(),
        content: truncated,
        bytes,
    }))
}

pub async fn skill_reveal(
    State(state): State<AppState>,
    Json(q): Json<ContentQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Same allowlist as skill_content: only SKILL.md files under known roots.
    let req = PathBuf::from(&q.path);
    let canonical = std::fs::canonicalize(&req).map_err(|_| StatusCode::NOT_FOUND)?;
    let mut roots: Vec<PathBuf> = skill_roots()
        .into_iter()
        .filter_map(|r| std::fs::canonicalize(&r).ok())
        .collect();
    roots.extend(discovered_project_skill_roots(&state).await);
    if !roots.iter().any(|r| canonical.starts_with(r)) {
        return Err(StatusCode::FORBIDDEN);
    }
    if canonical.file_name().and_then(|n| n.to_str()) != Some("SKILL.md") {
        return Err(StatusCode::FORBIDDEN);
    }
    // macOS: `open -R` reveals in Finder. Linux: `xdg-open <dir>`. Windows: `explorer /select,`.
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg("-R")
        .arg(&canonical)
        .status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open")
        .arg(canonical.parent().unwrap_or(&canonical))
        .status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(format!("/select,{}", canonical.display()))
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let result: Result<std::process::ExitStatus, std::io::Error> =
        Err(std::io::Error::other("unsupported platform"));

    match result {
        Ok(_) => Ok(Json(serde_json::json!({"ok": true}))),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(Serialize)]
pub struct SessionSkillEntry {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub invoked: bool,
}

#[derive(Serialize)]
pub struct SessionSkillsResponse {
    pub agent: String,
    pub cwd: String,
    pub skills: Vec<SessionSkillEntry>,
    pub total: usize,
    pub by_source: HashMap<String, usize>,
}

pub async fn session_skills(
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<AppState>,
) -> Result<Json<SessionSkillsResponse>, StatusCode> {
    let detail = state
        .adapter
        .get_detail(&id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let metas = state
        .adapter
        .list_sessions()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let meta = metas
        .iter()
        .find(|m| m.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let agent_key = serde_json::to_value(meta.agent)
        .ok()
        .and_then(|v| v.as_str().map(|x| x.to_string()))
        .unwrap_or_else(|| format!("{:?}", meta.agent).to_lowercase());
    let cwd = meta.cwd.clone();
    let invoked: std::collections::HashSet<String> = detail.skills_invoked.into_iter().collect();

    let home = std::env::var("HOME").unwrap_or_default();
    let mut sources: Vec<(&'static str, PathBuf)> = vec![(
        "agents-skills",
        PathBuf::from(format!("{home}/.agents/skills")),
    )];
    match agent_key.as_str() {
        "copilot" => {
            sources.push((
                "copilot-superpowers",
                PathBuf::from(format!("{home}/.copilot/installed-plugins")),
            ));
            sources.push(("project-github", cwd.join(".github").join("skills")));
            sources.push(("project-agents", cwd.join(".agents").join("skills")));
        }
        "claude" => {
            sources.push((
                "claude-skills",
                PathBuf::from(format!("{home}/.claude/skills")),
            ));
            sources.push(("project-claude", cwd.join(".claude").join("skills")));
            sources.push(("project-agents", cwd.join(".agents").join("skills")));
        }
        _ => {
            sources.push(("project-agents", cwd.join(".agents").join("skills")));
        }
    }

    let mut skills: Vec<SessionSkillEntry> = Vec::new();
    let mut by_source: HashMap<String, usize> = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    for (label, root) in sources {
        let found = scan_skills_recursive(&root, label, 4);
        for s in found {
            if !seen.insert(s.path.clone()) {
                continue;
            }
            let inv = invoked.contains(&s.name);
            *by_source.entry(label.to_string()).or_default() += 1;
            skills.push(SessionSkillEntry {
                name: s.name,
                description: s.description,
                source: label.to_string(),
                path: s.path,
                invoked: inv,
            });
        }
    }
    skills.sort_by(|a, b| b.invoked.cmp(&a.invoked).then_with(|| a.name.cmp(&b.name)));

    let total = skills.len();
    Ok(Json(SessionSkillsResponse {
        agent: agent_key,
        cwd: cwd.display().to_string(),
        skills,
        total,
        by_source,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_basic_frontmatter() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path().join("hello");
        fs::create_dir(&skill_dir).unwrap();
        let md = skill_dir.join("SKILL.md");
        fs::write(
            &md,
            "---\nname: hello\ndescription: Says hi.\n---\n# Body\n",
        )
        .unwrap();
        let s = parse_skill_md(&md, "test").unwrap();
        assert_eq!(s.name, "hello");
        assert_eq!(s.description, "Says hi.");
    }

    #[test]
    fn parses_folded_description() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path().join("agent");
        fs::create_dir(&skill_dir).unwrap();
        let md = skill_dir.join("SKILL.md");
        fs::write(
            &md,
            "---\nname: agent\ndescription: >\n  Multi line\n  folded text.\n---\n",
        )
        .unwrap();
        let s = parse_skill_md(&md, "test").unwrap();
        assert_eq!(s.name, "agent");
        assert!(s.description.contains("Multi line"));
    }

    #[test]
    fn scans_nested_skills_directory() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("plugin/foo/skills/skill-a");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("SKILL.md"),
            "---\nname: skill-a\ndescription: Test\n---\n",
        )
        .unwrap();
        let found = scan_skills_recursive(dir.path(), "test", 5);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "skill-a");
    }
}
