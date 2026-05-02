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
  ids: string[];
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

function TokenCompareChart({ details, metas }: { details: (Detail | null)[]; metas: (Session | undefined)[] }) {
  const { fmt } = useT();
  const maxVal = Math.max(1, ...details.map(d => Math.max(d?.tokens_in ?? 0, d?.tokens_out ?? 0)));
  const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`;

  return (
    <section className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">Token 用量对比</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-400/70" /> Input</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-400/70" /> Output</span>
        </div>
      </div>
      <div className="flex items-end gap-4 justify-center" style={{ height: 160 }}>
        {details.map((d, i) => {
          const tin = d?.tokens_in ?? 0;
          const tout = d?.tokens_out ?? 0;
          const hIn = maxVal > 0 ? (tin / maxVal) * 140 : 0;
          const hOut = maxVal > 0 ? (tout / maxVal) * 140 : 0;
          const m = metas[i];
          const cost = estimateCostUsd(m?.model ?? null, tin, tout);
          return (
            <div key={i} className="flex flex-col items-center gap-1 min-w-[60px] max-w-[120px]">
              <div className="flex items-end gap-1" style={{ height: 140 }}>
                <div className="w-6 rounded-t bg-cyan-400/70 transition-all" style={{ height: Math.max(2, hIn) }} title={`Input: ${fmt(tin)}`} />
                <div className="w-6 rounded-t bg-violet-400/70 transition-all" style={{ height: Math.max(2, hOut) }} title={`Output: ${fmt(tout)}`} />
              </div>
              <div className="text-[10px] text-slate-300 tabular-nums">{fmtK(tin + tout)}</div>
              {cost != null && <div className="text-[10px] text-amber-300 tabular-nums">{formatUsd(cost)}</div>}
              <div className="text-[10px] text-slate-500 truncate max-w-[100px] text-center" title={m?.summary || m?.id}>
                {m?.summary?.slice(0, 20) || m?.id?.slice(0, 8) || `#${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-center text-[10px] text-slate-600 mt-1">max: {fmtK(maxVal)}</div>
    </section>
  );
}

export function CompareView({ ids, sessions, onClose, onOpenSession }: Props) {
  const { t, fmt } = useT();
  const [details, setDetails] = useState<(Detail | null)[]>(() => ids.map(() => null));
  const [err, setErr] = useState<string | null>(null);

  const metas = useMemo(() => ids.map(id => sessions.find(s => s.id === id)), [ids, sessions]);

  useEffect(() => {
    let cancelled = false;
    setDetails(ids.map(() => null));
    Promise.all(ids.map(id => fetchDetail(id)))
      .then(results => { if (!cancelled) setDetails(results); })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [ids.join(',')]);

  const promptDiff = useMemo(
    () => ids.length === 2 ? comparePrompts(details[0]?.prompts, details[1]?.prompts) : null,
    [details, ids.length],
  );

  const toolFreq = useMemo(() => {
    const freq = new Map<string, number>();
    const n = details.filter(Boolean).length;
    details.forEach(d => {
      Object.keys(d?.tools_used || {}).forEach(tool => freq.set(tool, (freq.get(tool) || 0) + 1));
    });
    const all: string[] = [];
    const some: { name: string; count: number }[] = [];
    const unique: string[] = [];
    for (const [name, count] of freq) {
      if (count === n) all.push(name);
      else if (count > 1) some.push({ name, count });
      else unique.push(name);
    }
    some.sort((a, b) => b.count - a.count);
    return { all, some, unique, total: n };
  }, [details]);

  const gridCols = ids.length <= 2 ? 'grid-cols-2' : ids.length === 3 ? 'grid-cols-3' : ids.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-5';

  const renderCard = (idx: number) => {
    const m = metas[idx];
    const d = details[idx];
    if (!m) return <div className="text-rose-300 text-sm">Session not found</div>;
    const tools = topN(d?.tools_used);
    const skills = topN(d?.skills_invoked);
    const tin = d?.tokens_in ?? 0;
    const tout = d?.tokens_out ?? 0;
    const cost = estimateCostUsd(m.model ?? null, tin, tout);
    const dur = fmtDuration(m.started_at, m.last_event_at);
    return (
      <section className="min-w-0 bg-slate-900/30 border border-slate-800 rounded-lg p-4 space-y-3">
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

      <TokenCompareChart details={details} metas={metas} />

      <div className={`grid ${gridCols} gap-4`}>
        {ids.map((_, idx) => (
          <div key={ids[idx]}>{renderCard(idx)}</div>
        ))}
      </div>

      <section className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-3">{t('compare.tool_overlap')}</h3>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <OverlapCol
            label={`${t('compare.tool_shared_all')} (${toolFreq.all.length})`}
            items={toolFreq.all.map(n => ({ name: n }))}
            accent="emerald"
          />
          <OverlapCol
            label={`${t('compare.tool_shared_some')} (${toolFreq.some.length})`}
            items={toolFreq.some.map(s => ({ name: s.name, badge: `${s.count}/${toolFreq.total}` }))}
            accent="cyan"
          />
          <OverlapCol
            label={`${t('compare.tool_unique')} (${toolFreq.unique.length})`}
            items={toolFreq.unique.map(n => ({ name: n }))}
            accent="violet"
          />
        </div>
      </section>

      <section className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-3">{t('compare.prompt_diff')}</h3>
        {ids.length === 2 && promptDiff ? (
          <>
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
          </>
        ) : (
          <div className="text-xs text-slate-500 italic">{t('compare.prompt_diff_2only')}</div>
        )}
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

function OverlapCol({ label, items, accent }: { label: string; items: { name: string; badge?: string }[]; accent: 'emerald' | 'cyan' | 'violet' }) {
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
            {items.slice(0, 12).map(i => (
              <li key={i.name} className="flex items-center justify-between truncate">
                <span className="truncate">{i.name}</span>
                {i.badge && <span className="text-[10px] text-slate-500 ml-1 shrink-0">{i.badge}</span>}
              </li>
            ))}
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
