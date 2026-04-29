import { useEffect, useState } from 'react';
import { fetchRealm, subscribeEvents } from '../api';

const AGENT_COLORS: Record<string, string> = {
  copilot: '#34d399',
  claude: '#a78bfa',
  codex: '#f59e0b',
};

type RealmSession = {
  id: string;
  agent: string;
  summary: string | null;
  branch: string | null;
  status: string;
  model: string | null;
  started_at: string;
  last_event_at: string;
  turns: number;
  tool_calls: number;
};

type Subagent = {
  session_id: string;
  id: string;
  turns: number;
  tool_calls: number;
  agent_type: string | null;
  description: string | null;
  active: boolean;
};

type RealmDetail = {
  name: string;
  agents: string[];
  total_sessions: number;
  total_turns: number;
  total_tool_calls: number;
  tools_used: [string, number][];
  skills_invoked: [string, number][];
  subagents: Subagent[];
  activity_336h: number[];
  sessions: RealmSession[];
};

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Sparkline({ values, height = 60, color = '#fbbf24' }: { values: number[]; height?: number; color?: string }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const w = 100;
  const h = height;
  const step = w / (values.length - 1 || 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ');
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polygon points={area} fill={color} fillOpacity="0.15" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function aggregateDaily(hourly: number[]): number[] {
  const days: number[] = [];
  for (let d = 0; d < 14; d++) {
    let sum = 0;
    for (let h = 0; h < 24; h++) sum += hourly[d * 24 + h] ?? 0;
    days.push(sum);
  }
  return days;
}

export function RealmPanel({
  name,
  onOpenSession,
  onBack,
}: {
  name: string;
  onOpenSession: (id: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<RealmDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchRealm(name)
        .then(d => !cancelled && setData(d))
        .catch(e => !cancelled && setErr(String(e)));
    };
    load();
    const t = setInterval(load, 15000);
    const unsub = subscribeEvents(ev => {
      if (cancelled) return;
      if (ev.kind === 'session_list_changed' || ev.kind === 'detail_updated' || ev.kind === 'closed') {
        load();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(t);
      unsub();
    };
  }, [name]);

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">{err}</main>;
  if (!data) return <main className="flex-1 p-8 text-slate-500 text-sm">Loading realm…</main>;

  const daily = aggregateDaily(data.activity_336h);
  const thisWeek = daily.slice(7).reduce((a, b) => a + b, 0);
  const prevWeek = daily.slice(0, 7).reduce((a, b) => a + b, 0);
  const toolMax = data.tools_used[0]?.[1] ?? 0;

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-5 pb-4 border-b border-slate-800 bg-gradient-to-br from-amber-950/30 to-slate-900/30">
        <button
          onClick={onBack}
          className="text-[11px] text-slate-500 hover:text-slate-300 mb-2 inline-flex items-center gap-1"
        >
          ← back to overview
        </button>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl">👑</span>
          <h1 className="text-2xl font-mono font-semibold text-slate-100" title={data.name}>
            {data.name}
          </h1>
          <div className="flex items-center gap-1.5 ml-2">
            {data.agents.map(a => (
              <span
                key={a}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  background: `${AGENT_COLORS[a] ?? '#64748b'}22`,
                  color: AGENT_COLORS[a] ?? '#94a3b8',
                  border: `1px solid ${AGENT_COLORS[a] ?? '#64748b'}55`,
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Sessions</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums text-slate-100">{data.total_sessions}</div>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Turns</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums text-amber-300">{data.total_turns.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Tool calls</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums text-violet-300">{data.total_tool_calls.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Subagents</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums text-indigo-300">{data.subagents.length}</div>
          </div>
        </section>

        <section className="rounded-lg bg-slate-900/40 border border-slate-800 p-4">
          <header className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs uppercase tracking-wider text-slate-400">14-day activity (turns)</h3>
            <span className="text-[11px] text-slate-500">
              this 7d: <span className="text-emerald-300">{thisWeek.toLocaleString()}</span> · prev 7d:{' '}
              <span className="text-slate-300">{prevWeek.toLocaleString()}</span>
            </span>
          </header>
          <Sparkline values={daily} />
          <div className="grid grid-cols-14 mt-1 text-[9px] text-slate-600" style={{ gridTemplateColumns: 'repeat(14, minmax(0,1fr))' }}>
            {Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="text-center">
                {i === 0 ? '−14d' : i === 6 ? '−8d' : i === 7 ? '−7d' : i === 13 ? 'now' : ''}
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Top tools</h3>
            </header>
            <ul className="p-3 space-y-1.5">
              {data.tools_used.slice(0, 12).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-300 w-32 truncate" title={k}>{k}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500/60 to-amber-400"
                      style={{ width: `${toolMax > 0 ? (v / toolMax) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-slate-400 tabular-nums w-12 text-right">{v.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Skills invoked</h3>
              <span className="text-[11px] text-slate-500">{data.skills_invoked.length}</span>
            </header>
            <ul className="p-3 flex flex-wrap gap-1.5">
              {data.skills_invoked.map(([k, v]) => (
                <li key={k} className="px-2 py-1 rounded bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200">
                  <span className="font-mono">{k}</span>
                  {v > 1 && <span className="ml-1.5 text-sky-400">×{v}</span>}
                </li>
              ))}
              {data.skills_invoked.length === 0 && (
                <li className="text-xs text-slate-600">none</li>
              )}
            </ul>
          </div>
        </section>

        {data.subagents.length > 0 && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Top subagents</h3>
              <span className="text-[11px] text-slate-500">
                {data.subagents.length} dispatch{data.subagents.length === 1 ? '' : 'es'}
                {' · '}
                {data.subagents.filter(s => s.active).length} active
              </span>
            </header>
            <ul className="divide-y divide-slate-800/60">
              {(() => {
                const groups = new Map<string, { type: string; count: number; turns: number; tool_calls: number; active: number; sample: string | null }>();
                for (const s of data.subagents) {
                  const key = s.agent_type || 'unknown';
                  const g = groups.get(key) ?? { type: key, count: 0, turns: 0, tool_calls: 0, active: 0, sample: null };
                  g.count += 1;
                  g.turns += s.turns;
                  g.tool_calls += s.tool_calls;
                  if (s.active) g.active += 1;
                  if (!g.sample && s.description) g.sample = s.description;
                  groups.set(key, g);
                }
                const rows = [...groups.values()].sort((a, b) => b.tool_calls - a.tool_calls || b.turns - a.turns).slice(0, 10);
                const maxTools = Math.max(1, ...rows.map(r => r.tool_calls));
                return rows.map(r => (
                  <li key={r.type} className="px-4 py-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-indigo-200 truncate">{r.type}</span>
                        <span className="text-[11px] text-slate-500 tabular-nums">×{r.count}</span>
                        {r.active > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {r.active} live
                          </span>
                        )}
                      </div>
                      {r.sample && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5" title={r.sample}>
                          {r.sample}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] tabular-nums">
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 h-1.5 rounded bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-violet-400"
                            style={{ width: `${(r.tool_calls / maxTools) * 100}%` }}
                          />
                        </div>
                        <span className="text-slate-300 w-12 text-right">{r.tool_calls.toLocaleString()}</span>
                      </div>
                      <span className="text-slate-500 w-14 text-right">{r.turns.toLocaleString()} turns</span>
                    </div>
                  </li>
                ));
              })()}
            </ul>
          </section>
        )}

        <section className="rounded-lg bg-slate-900/40 border border-slate-800">
          <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wider text-slate-400">Sessions in this realm</h3>
            <span className="text-[11px] text-slate-500">{data.sessions.length} total</span>
          </header>
          <ul className="divide-y divide-slate-800/60">
            {data.sessions
              .slice()
              .sort((a, b) => new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime())
              .map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(s.id)}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        s.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    />
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider flex-shrink-0"
                      style={{
                        background: `${AGENT_COLORS[s.agent] ?? '#64748b'}22`,
                        color: AGENT_COLORS[s.agent] ?? '#94a3b8',
                        border: `1px solid ${AGENT_COLORS[s.agent] ?? '#64748b'}55`,
                      }}
                    >
                      {s.agent}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate" title={s.summary || s.id}>
                        {s.summary || <span className="font-mono text-[11px] text-slate-500">{s.id.slice(0, 12)}</span>}
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5 flex gap-2">
                        {s.branch && <span>{s.branch}</span>}
                        {s.model && <span className="font-mono">{s.model}</span>}
                        <span>{timeAgo(s.last_event_at)}</span>
                      </div>
                    </div>
                    <span className="text-xs tabular-nums text-amber-300 flex-shrink-0">
                      {s.turns.toLocaleString()}<span className="text-slate-600 text-[10px]"> turns</span>
                    </span>
                    <span className="text-xs tabular-nums text-violet-300 flex-shrink-0">
                      {s.tool_calls.toLocaleString()}<span className="text-slate-600 text-[10px]"> tools</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
