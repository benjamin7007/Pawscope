import { useEffect, useMemo, useState } from 'react';
import { fetchDetail } from '../api';
import { estimateCostUsd, formatUsd } from '../pricing';
import { useT } from '../i18n';

type Session = {
  id: string;
  agent: string;
  cwd?: string | null;
  repo?: string | null;
  branch?: string | null;
  summary?: string | null;
  model?: string | null;
  status: string;
  started_at?: string | null;
  last_event_at?: string | null;
};

type Detail = {
  turns?: number;
  user_messages?: number;
  assistant_messages?: number;
  tools_used?: Record<string, number>;
  skills_invoked?: Record<string, number>;
  subagents?: number;
  prompts?: { ts: string; text: string }[];
  tool_calls?: any[];
  tokens_in?: number;
  tokens_out?: number;
};

interface Props {
  ids: [string, string];
  sessions: Session[];
  onClose: () => void;
  onOpenSession: (id: string) => void;
}

function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

function topN(map: Record<string, number> | undefined, n = 8): [string, number][] {
  if (!map) return [];
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function promptTokenSet(p: { text: string }): Set<string> {
  const out = new Set<string>();
  const ms = p.text.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{3,}/g) || [];
  for (const m of ms) out.add(m);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Compute prompt-overlap diff between the two sessions: list prompts
// that share token-set similarity ≥ 0.3 with the other side, plus
// top "unique" prompts on each side (no strong match).
function comparePrompts(
  a: { ts: string; text: string }[] | undefined,
  b: { ts: string; text: string }[] | undefined,
): { shared: { left: number; right: number; sim: number; left_text: string; right_text: string }[]; uniqueA: string[]; uniqueB: string[] } {
  const A = (a || []).slice(0, 80);
  const B = (b || []).slice(0, 80);
  const TA = A.map(promptTokenSet);
  const TB = B.map(promptTokenSet);
  const shared: { left: number; right: number; sim: number; left_text: string; right_text: string }[] = [];
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  for (let i = 0; i < A.length; i++) {
    let bestJ = -1;
    let bestSim = 0.3;
    for (let j = 0; j < B.length; j++) {
      if (matchedB.has(j)) continue;
      const sim = jaccard(TA[i], TB[j]);
      if (sim >= bestSim) { bestSim = sim; bestJ = j; }
    }
    if (bestJ >= 0) {
      shared.push({ left: i, right: bestJ, sim: bestSim, left_text: A[i].text, right_text: B[bestJ].text });
      matchedA.add(i);
      matchedB.add(bestJ);
    }
  }
  shared.sort((x, y) => y.sim - x.sim);
  const uniqueA = A.filter((_, i) => !matchedA.has(i)).slice(0, 6).map(p => p.text);
  const uniqueB = B.filter((_, i) => !matchedB.has(i)).slice(0, 6).map(p => p.text);
  return { shared: shared.slice(0, 6), uniqueA, uniqueB };
}

export function CompareView({ ids, sessions, onClose, onOpenSession }: Props) {
  const { t, fmt } = useT();
  const [details, setDetails] = useState<[Detail | null, Detail | null]>([null, null]);
  const [err, setErr] = useState<string | null>(null);

  const meta: [Session | undefined, Session | undefined] = [
    sessions.find(s => s.id === ids[0]),
    sessions.find(s => s.id === ids[1]),
  ];

  useEffect(() => {
    let cancelled = false;
    Promise.all(ids.map(id => fetchDetail(id)))
      .then(([a, b]) => { if (!cancelled) setDetails([a, b]); })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [ids[0], ids[1]]);

  const promptDiff = useMemo(
    () => comparePrompts(details[0]?.prompts, details[1]?.prompts),
    [details],
  );

  // Top-tools / top-skills overlap
  const toolsOverlap = useMemo(() => {
    const a = new Set(Object.keys(details[0]?.tools_used || {}));
    const b = new Set(Object.keys(details[1]?.tools_used || {}));
    const both: string[] = [];
    a.forEach(x => { if (b.has(x)) both.push(x); });
    return { shared: both, onlyA: [...a].filter(x => !b.has(x)), onlyB: [...b].filter(x => !a.has(x)) };
  }, [details]);

  const renderColumn = (idx: 0 | 1) => {
    const m = meta[idx];
    const d = details[idx];
    if (!m) return <div className="text-rose-300 text-sm">Session not found</div>;
    const tools = topN(d?.tools_used);
    const skills = topN(d?.skills_invoked);
    const tin = d?.tokens_in ?? 0;
    const tout = d?.tokens_out ?? 0;
    const cost = estimateCostUsd(m.model ?? null, tin, tout);
    const dur = fmtDuration(m.started_at, m.last_event_at);
    return (
      <section className="flex-1 min-w-0 bg-slate-900/30 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{m.agent}</div>
            <h2
              className="text-sm font-semibold text-slate-100 truncate cursor-pointer hover:text-emerald-300"
              onClick={() => onOpenSession(m.id)}
              title={t('compare.open_session')}
            >
              {m.summary || m.id.slice(0, 8)}
            </h2>
            <div className="text-[11px] text-slate-500 truncate">{m.repo || m.cwd || '—'}{m.branch ? ` · ${m.branch}` : ''}</div>
            {m.model && <div className="text-[11px] text-slate-500 font-mono mt-0.5">{m.model}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label={t('compare.turns')} value={fmt(d?.turns ?? 0)} />
          <Stat label={t('compare.duration')} value={dur} />
          <Stat label={t('compare.user_msgs')} value={fmt(d?.user_messages ?? 0)} />
          <Stat label={t('compare.tool_calls')} value={fmt((d?.tool_calls?.length ?? 0))} />
          <Stat label={t('compare.tokens_in')} value={fmt(tin)} />
          <Stat label={t('compare.tokens_out')} value={fmt(tout)} />
          <Stat label={t('compare.cost')} value={cost == null ? '—' : formatUsd(cost)} />
          <Stat label={t('compare.subagents')} value={fmt(d?.subagents ?? 0)} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{t('compare.top_tools')}</div>
          {tools.length === 0
            ? <div className="text-xs text-slate-600">—</div>
            : (
              <ul className="space-y-1">
                {tools.map(([n, c]) => (
                  <li key={n} className="flex items-center justify-between text-xs">
                    <span className="font-mono truncate text-slate-300">{n}</span>
                    <span className="text-slate-500 tabular-nums">{c}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{t('compare.top_skills')}</div>
          {skills.length === 0
            ? <div className="text-xs text-slate-600">—</div>
            : (
              <ul className="space-y-1">
                {skills.map(([n, c]) => (
                  <li key={n} className="flex items-center justify-between text-xs">
                    <span className="font-mono truncate text-slate-300">{n}</span>
                    <span className="text-slate-500 tabular-nums">{c}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>
    );
  };

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">{t('compare.kicker')}</div>
          <h1 className="text-xl font-semibold text-slate-100">{t('compare.title')}</h1>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100"
        >
          ✕ {t('compare.close')}
        </button>
      </header>

      <div className="flex gap-4 items-stretch">
        {renderColumn(0)}
        {renderColumn(1)}
      </div>

      <section className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-3">{t('compare.tool_overlap')}</h3>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <OverlapCol label={`${t('compare.shared')} (${toolsOverlap.shared.length})`} items={toolsOverlap.shared} accent="emerald" />
          <OverlapCol label={`${t('compare.only_left')} (${toolsOverlap.onlyA.length})`} items={toolsOverlap.onlyA} accent="cyan" />
          <OverlapCol label={`${t('compare.only_right')} (${toolsOverlap.onlyB.length})`} items={toolsOverlap.onlyB} accent="violet" />
        </div>
      </section>

      <section className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-3">{t('compare.prompt_diff')}</h3>
        {promptDiff.shared.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] text-emerald-300 mb-1.5">≈ {t('compare.shared_prompts')}</div>
            <ul className="space-y-2">
              {promptDiff.shared.map((s, i) => (
                <li key={i} className="grid grid-cols-2 gap-3 text-[11px] border-l-2 border-emerald-500/40 pl-2">
                  <div className="text-slate-300 line-clamp-2 break-words">{s.left_text}</div>
                  <div className="text-slate-300 line-clamp-2 break-words">{s.right_text}</div>
                  <div className="col-span-2 text-[10px] text-slate-500">jaccard ≈ {s.sim.toFixed(2)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <UniqueCol label={t('compare.unique_left')} items={promptDiff.uniqueA} />
          <UniqueCol label={t('compare.unique_right')} items={promptDiff.uniqueB} />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-slate-950/40 border border-slate-800/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

function OverlapCol({ label, items, accent }: { label: string; items: string[]; accent: 'emerald' | 'cyan' | 'violet' }) {
  const tone = {
    emerald: 'text-emerald-300',
    cyan: 'text-cyan-300',
    violet: 'text-violet-300',
  }[accent];
  return (
    <div>
      <div className={`text-[11px] mb-1 ${tone}`}>{label}</div>
      {items.length === 0
        ? <div className="text-slate-600">—</div>
        : (
          <ul className="space-y-0.5 font-mono text-slate-300">
            {items.slice(0, 12).map(i => <li key={i} className="truncate">{i}</li>)}
            {items.length > 12 && <li className="text-slate-600">+{items.length - 12} more</li>}
          </ul>
        )}
    </div>
  );
}

function UniqueCol({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      {items.length === 0
        ? <div className="text-xs text-slate-600">—</div>
        : (
          <ul className="space-y-1.5">
            {items.map((p, i) => (
              <li key={i} className="text-[11px] text-slate-300 line-clamp-2 break-words border-l border-slate-700 pl-2">
                {p}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
