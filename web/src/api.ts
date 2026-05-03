export async function fetchSessions() {
  const r = await fetch('/api/sessions');
  return r.json();
}
export async function fetchDetail(id: string) {
  const r = await fetch(`/api/sessions/${id}`);
  return r.json();
}
export async function fetchOverview() {
  const r = await fetch('/api/overview');
  return r.json();
}
export async function fetchActivity() {
  const r = await fetch('/api/activity');
  return r.json();
}
export async function fetchActivityGrid() {
  const r = await fetch('/api/activity/grid');
  return r.json();
}

export async function fetchRealm(name: string) {
  const r = await fetch(`/api/realms?name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`realm fetch ${r.status}`);
  return r.json();
}

export interface SkillEntry {
  name: string;
  description: string;
  source: string;
  path: string;
  invocations: number;
}
export interface SkillsResponse {
  skills: SkillEntry[];
  total: number;
  by_source: Record<string, number>;
}
export async function fetchSkills(): Promise<SkillsResponse> {
  const r = await fetch('/api/skills');
  if (!r.ok) throw new Error(`skills fetch ${r.status}`);
  return r.json();
}

export interface SkillContent {
  path: string;
  content: string;
  bytes: number;
}
export async function fetchSkillContent(path: string): Promise<SkillContent> {
  const r = await fetch(`/api/skills/content?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`skill content fetch ${r.status}`);
  return r.json();
}

export interface SkillUsageSession {
  id: string;
  agent: string;
  summary: string;
  repo: string | null;
  last_event_at: string;
  invocations: number;
}
export interface SkillCoOccurrence {
  name: string;
  sessions: number;
}
export interface SkillUsage {
  name: string;
  total_invocations: number;
  session_count: number;
  daily30: number[];
  daily365: number[];
  cooccurring: SkillCoOccurrence[];
  sessions: SkillUsageSession[];
}
export async function fetchSkillUsage(name: string): Promise<SkillUsage> {
  const r = await fetch(`/api/skills/usage?name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`skill usage fetch ${r.status}`);
  return r.json();
}

export async function revealSkill(path: string): Promise<void> {
  const r = await fetch('/api/skills/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) throw new Error(`skill reveal ${r.status}`);
}

export type SessionEventMsg =
  | { kind: 'session_list_changed' }
  | { kind: 'detail_updated'; session_id: string; detail: unknown }
  | { kind: 'closed'; session_id: string }
  | { kind: 'conversation_updated'; session_id: string; version: number };

export function subscribeEvents(onEvent: (ev: SessionEventMsg) => void): () => void {
  const es = new EventSource('/api/events');
  const handler = (e: MessageEvent) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  es.addEventListener('session', handler);
  return () => {
    es.removeEventListener('session', handler);
    es.close();
  };
}
export function connectWs(onEvent: (ev: any) => void): WebSocket {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => { try { onEvent(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => setTimeout(() => connectWs(onEvent), 1000);
  return ws;
}

// ---------------------------------------------------------------------------
// Skill Store
// ---------------------------------------------------------------------------

export interface StoreSkill {
  name: string;
  description: string;
  assets: string[];
  category: string;
  installed: boolean;
  installed_scope: string;
}
export interface CategoryCount {
  name: string;
  count: number;
}
export interface StoreCatalog {
  skills: StoreSkill[];
  total: number;
  categories: CategoryCount[];
  source: string;
  last_updated: string | null;
  commit_sha: string | null;
}
export async function fetchStoreCatalog(projectPath?: string): Promise<StoreCatalog> {
  const params = new URLSearchParams();
  if (projectPath) params.set('project_path', projectPath);
  const url = params.toString() ? `/api/store/catalog?${params}` : '/api/store/catalog';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`store catalog ${r.status}`);
  return r.json();
}

export interface SkillDetail {
  name: string;
  description: string;
  content: string;
  files: string[];
}
export async function fetchStoreSkillDetail(name: string): Promise<SkillDetail> {
  const r = await fetch(`/api/store/skill/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`skill detail ${r.status}`);
  return r.json();
}

export async function installStoreSkill(
  name: string,
  scope: 'project' | 'global' = 'project',
  projectPath?: string,
): Promise<{ installed: boolean; path: string }> {
  const r = await fetch('/api/store/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope, project_path: projectPath }),
  });
  if (!r.ok) throw new Error(`install ${r.status}`);
  return r.json();
}

export async function uninstallStoreSkill(
  name: string,
  scope: 'project' | 'global' = 'project',
  projectPath?: string,
): Promise<{ uninstalled: boolean }> {
  const r = await fetch('/api/store/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope, project_path: projectPath }),
  });
  if (!r.ok) throw new Error(`uninstall ${r.status}`);
  return r.json();
}

export async function refreshStoreCatalog(): Promise<void> {
  const r = await fetch('/api/store/refresh', { method: 'POST' });
  if (!r.ok) throw new Error(`refresh ${r.status}`);
}

// ---------------------------------------------------------------------------
// Copilot Config
// ---------------------------------------------------------------------------

export interface CopilotPlugin {
  name: string;
  version: string;
  marketplace: string;
}
export interface AgentEntry {
  name: string;
  description: string;
  full_description: string;
  source: string;
}
export interface CopilotConfig {
  instructions: string | null;
  model: string | null;
  effort_level: string | null;
  plugins: CopilotPlugin[];
  skills_count: number;
  agents: AgentEntry[];
}
export async function fetchCopilotConfig(): Promise<CopilotConfig> {
  const r = await fetch('/api/config/copilot');
  if (!r.ok) throw new Error(`config fetch ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// All Agents Config
// ---------------------------------------------------------------------------

export interface AgentConfigInfo {
  agent: string;
  installed: boolean;
  data_path: string | null;
  model: string | null;
  settings: Record<string, unknown>;
  instructions: string | null;
}
export interface AllAgentsConfigResponse {
  agents: AgentConfigInfo[];
}
export async function fetchAllAgentsConfig(): Promise<AllAgentsConfigResponse> {
  const r = await fetch('/api/config/agents');
  if (!r.ok) throw new Error(`agents config fetch ${r.status}`);
  return r.json();
}

export interface ToolTrendSeries {
  name: string;
  counts: number[];
  total: number;
}
export interface ToolTrendResponse {
  hours: number;
  window_start: string;
  now: string;
  series: ToolTrendSeries[];
  totals: number[];
}
export async function fetchToolsTrend(hours = 168, top = 6): Promise<ToolTrendResponse> {
  const r = await fetch(`/api/tools/trend?hours=${hours}&top=${top}`);
  if (!r.ok) throw new Error(`tools trend ${r.status}`);
  return r.json();
}

export interface BucketHit {
  session_id: string;
  agent: string;
  cwd: string | null;
  count: number;
  last_event_at: string;
}
export async function fetchToolsBucket(
  since: string,
  until: string,
  tool?: string,
): Promise<BucketHit[]> {
  const params = new URLSearchParams({ since, until, limit: '50' });
  if (tool) params.set('tool', tool);
  const r = await fetch(`/api/tools/bucket?${params}`);
  if (!r.ok) throw new Error(`tools bucket ${r.status}`);
  return r.json();
}

export interface PromptHit {
  session_id: string;
  agent: string;
  cwd: string;
  repo: string | null;
  branch: string | null;
  summary: string;
  prompt_id: string;
  timestamp: string | null;
  snippet: string;
  text: string;
}
export interface PromptSearchFilters {
  agent?: string;
  repo?: string;
  since?: string;
  until?: string;
}
export async function searchPrompts(
  q: string,
  limit = 50,
  filters: PromptSearchFilters = {},
): Promise<PromptHit[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  const r = await fetch(`/api/prompts/search?${params}`);
  if (!r.ok) throw new Error(`prompts search ${r.status}`);
  return r.json();
}

export interface Label {
  starred: boolean;
  tags: string[];
  note?: string | null;
  custom_name?: string | null;
}
export type LabelMap = Record<string, Label>;

export async function fetchLabels(): Promise<LabelMap> {
  const r = await fetch('/api/labels');
  if (!r.ok) return {};
  return r.json();
}
export async function setLabel(id: string, label: Label): Promise<Label> {
  const r = await fetch(`/api/labels/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!r.ok) throw new Error(`set label ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// Session hide / delete
// ---------------------------------------------------------------------------

export async function hideSession(id: string): Promise<{ hidden: boolean; id: string }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/hide`, { method: 'POST' });
  if (!r.ok) throw new Error(`hide ${r.status}`);
  return r.json();
}

export async function unhideSession(id: string): Promise<{ hidden: boolean; id: string }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/unhide`, { method: 'POST' });
  if (!r.ok) throw new Error(`unhide ${r.status}`);
  return r.json();
}

export async function deleteSession(id: string): Promise<{ deleted: boolean; id: string; trash_path: string }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete ${r.status}`);
  return r.json();
}

export async function fetchHidden(): Promise<{ hidden: string[] }> {
  const r = await fetch('/api/sessions/hidden');
  if (!r.ok) return { hidden: [] };
  return r.json();
}

// ---------------------------------------------------------------------------
// Session instructions
// ---------------------------------------------------------------------------

export interface InstructionFile {
  name: string;
  rel_path: string;
  content: string;
  bytes: number;
}

export interface SessionInstructions {
  session_id: string;
  agent: string;
  cwd: string;
  project_files: InstructionFile[];
  global_instructions: string | null;
}

export async function fetchSessionInstructions(id: string): Promise<SessionInstructions> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/instructions`);
  if (!r.ok) throw new Error(`instructions fetch ${r.status}`);
  return r.json();
}
