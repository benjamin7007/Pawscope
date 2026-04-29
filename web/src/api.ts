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
export interface SkillUsage {
  name: string;
  total_invocations: number;
  session_count: number;
  daily30: number[];
  sessions: SkillUsageSession[];
}
export async function fetchSkillUsage(name: string): Promise<SkillUsage> {
  const r = await fetch(`/api/skills/usage?name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`skill usage fetch ${r.status}`);
  return r.json();
}

export type SessionEventMsg =
  | { kind: 'session_list_changed' }
  | { kind: 'detail_updated'; session_id: string; detail: unknown }
  | { kind: 'closed'; session_id: string };

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
