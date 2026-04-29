import { useMemo, useState } from 'react';

type Meta = {
  id: string;
  agent: string;
  cwd?: string | null;
  repo?: string | null;
  branch?: string | null;
  summary?: string | null;
  model?: string | null;
  status: string;
  pid?: number | null;
  started_at?: string | null;
  last_event_at?: string | null;
};

type Detail = {
  turns: number;
  user_messages: number;
  assistant_messages: number;
  tools_used: Record<string, number>;
  skills_invoked: string[];
  subagents?: { id: string; turns: number; tool_calls: number; tools?: Record<string, number> }[];
  prompts?: { id: string; timestamp: string | null; snippet: string }[];
};

type Props = { meta: Meta | undefined; detail: Detail | null };

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatAbs(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-100 mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
      title="Copy"
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}

export function SessionDetail({ meta, detail }: Props) {
  const tools = useMemo(() => {
    if (!detail?.tools_used) return [];
    return Object.entries(detail.tools_used).sort((a, b) => b[1] - a[1]);
  }, [detail]);
  const toolsTotal = tools.reduce((acc, [, v]) => acc + v, 0);
  const toolsMax = tools[0]?.[1] ?? 0;

  if (!meta) {
    return (
      <main className="flex-1 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="text-5xl mb-3 opacity-30">⌖</div>
          <div className="text-sm">Select a session from the left</div>
        </div>
      </main>
    );
  }

  const isActive = meta.status === 'active';

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-6 pb-5 border-b border-slate-800 bg-slate-900/30">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                {meta.status}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-slate-500">{meta.agent}</span>
              {meta.pid && (
                <span className="text-[11px] text-slate-500 font-mono">pid {meta.pid}</span>
              )}
            </div>
            <h1 className="text-2xl font-semibold text-slate-100 truncate">
              {meta.summary || <span className="text-slate-500 italic">(no summary)</span>}
            </h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs font-mono text-slate-500">{meta.id}</span>
              <CopyButton text={meta.id} />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 mt-5 text-xs">
          <div>
            <dt className="text-slate-500">Repo</dt>
            <dd className="text-slate-200 truncate">{meta.repo || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Branch</dt>
            <dd className="text-slate-200 truncate">⎇ {meta.branch || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Model</dt>
            <dd className="text-slate-200 truncate">{meta.model || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Last event</dt>
            <dd className="text-slate-200" title={formatAbs(meta.last_event_at)}>
              {timeAgo(meta.last_event_at)}
            </dd>
          </div>
          <div className="col-span-2 lg:col-span-4">
            <dt className="text-slate-500">CWD</dt>
            <dd className="text-slate-300 font-mono text-[11px] truncate">{meta.cwd || '—'}</dd>
          </div>
        </dl>
      </header>

      {!detail ? (
        <div className="p-8 text-sm text-slate-500">Loading detail…</div>
      ) : (
        <div className="p-6 space-y-6">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Turns" value={detail.turns} />
            <StatCard label="User msgs" value={detail.user_messages} hint="↑ inbound" />
            <StatCard label="Assistant msgs" value={detail.assistant_messages} hint="↓ outbound" />
            <StatCard label="Tool calls" value={toolsTotal} hint={`${tools.length} unique`} />
          </section>

          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Tools used</h3>
              <span className="text-[11px] text-slate-500">{toolsTotal} total</span>
            </header>
            {tools.length === 0 ? (
              <div className="px-4 py-6 text-xs text-slate-600 text-center">No tool calls recorded.</div>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {tools.map(([name, count]) => {
                  const pct = toolsMax > 0 ? (count / toolsMax) * 100 : 0;
                  return (
                    <li key={name} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="font-mono text-slate-200 w-32 truncate">{name}</span>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500/70 to-emerald-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-slate-400 tabular-nums w-12 text-right">×{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Skills invoked</h3>
              <span className="text-[11px] text-slate-500">{detail.skills_invoked.length}</span>
            </header>
            <div className="p-4">
              {detail.skills_invoked.length === 0 ? (
                <div className="text-xs text-slate-600 text-center py-2">No skills invoked.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {detail.skills_invoked.map(s => (
                    <span
                      key={s}
                      className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-slate-600"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {detail.subagents && detail.subagents.length > 0 && (
            <section className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">Subagents</h3>
                <span className="text-[11px] text-slate-500">{detail.subagents.length}</span>
              </header>
              <ul className="divide-y divide-slate-800/60">
                {detail.subagents.map(sa => {
                  const toolEntries = Object.entries(sa.tools || {}).sort((a, b) => b[1] - a[1]);
                  const maxTool = toolEntries[0]?.[1] ?? 1;
                  const hasTools = toolEntries.length > 0;
                  return (
                    <li key={sa.id}>
                      <details className="group">
                        <summary
                          className={`px-4 py-2 flex items-center gap-3 text-sm list-none ${hasTools ? 'cursor-pointer hover:bg-slate-800/30' : ''}`}
                        >
                          <span
                            className={`text-slate-600 text-xs w-3 transition-transform ${hasTools ? 'group-open:rotate-90' : 'opacity-30'}`}
                          >▶</span>
                          <span className="font-mono text-[11px] text-slate-300 truncate flex-1">{sa.id}</span>
                          <span className="text-slate-400 tabular-nums text-xs">
                            <span className="text-slate-500">turns</span> {sa.turns}
                          </span>
                          <span className="text-slate-400 tabular-nums text-xs">
                            <span className="text-slate-500">tools</span> {sa.tool_calls}
                          </span>
                        </summary>
                        {hasTools && (
                          <div className="px-4 pt-1 pb-3 space-y-1 bg-slate-900/30">
                            {toolEntries.map(([name, count]) => (
                              <div key={name} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-slate-400 w-28 truncate" title={name}>{name}</span>
                                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500/70"
                                    style={{ width: `${(count / maxTool) * 100}%` }}
                                  />
                                </div>
                                <span className="tabular-nums text-slate-300 w-10 text-right">{count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {detail.prompts && detail.prompts.length > 0 && (
            <section className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">Prompts</h3>
                <span className="text-[11px] text-slate-500">{detail.prompts.length}</span>
              </header>
              <ol className="divide-y divide-slate-800/60">
                {detail.prompts.map((p, i) => (
                  <li key={p.id} className="px-4 py-2.5 flex gap-3 text-sm">
                    <span className="text-slate-600 tabular-nums w-6 text-right flex-shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate" title={p.snippet}>
                        {p.snippet || <span className="italic text-slate-500">(empty)</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[10px] text-slate-600">{p.id.slice(0, 8)}</span>
                        {p.timestamp && (
                          <span className="text-[10px] text-slate-500" title={formatAbs(p.timestamp)}>
                            {timeAgo(p.timestamp)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="text-[11px] text-slate-600 px-1">
            Started {formatAbs(meta.started_at)} · Last event {formatAbs(meta.last_event_at)}
          </section>
        </div>
      )}
    </main>
  );
}
