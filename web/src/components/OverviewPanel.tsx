import { Fragment, useEffect, useMemo, useState } from 'react';
import { fetchOverview, fetchActivity, fetchActivityGrid, fetchSessions, fetchSkills, subscribeEvents, type SkillEntry } from '../api';
import { useT } from '../i18n';
import { categorize, CATEGORY_ORDER, categoryLabel } from '../skillCategory';
import { CategoryDonut } from './CategoryDonut';
import { OverviewSkeleton } from './Skeleton';
import { ToolTrend } from './ToolTrend';
import { estimateCostUsd, formatUsd, priceFor } from '../pricing';

type Session = {
  id: string;
  agent: string;
  cwd: string;
  repo: string | null;
  branch: string | null;
  summary: string;
  model: string | null;
  status: string;
  last_event_at: string;
};

type Subagent = {
  session_id: string;
  id: string;
  turns: number;
  tool_calls: number;
  agent_type: string | null;
  description: string | null;
  started_at: string | null;
  ended_at: string | null;
  active: boolean;
};

type Realm = {
  name: string;
  sessions: number;
  active: number;
  turns: number;
  tool_calls: number;
  sessions_this_week: number;
  sessions_prev_week: number;
  turns_this_week: number;
  turns_prev_week: number;
  daily14?: number[];
  last_event_at: string | null;
  agents: string[];
};

type Overview = {
  total_sessions: number;
  active_sessions: number;
  by_agent: Record<string, number>;
  by_repo: Record<string, number>;
  total_turns: number;
  total_user_messages: number;
  total_assistant_messages: number;
  total_tokens_in?: number;
  total_tokens_out?: number;
  tokens_by_agent?: Record<string, { in: number; out: number }>;
  tokens_daily7_in?: number[];
  tokens_daily7_out?: number[];
  tokens_daily30_in?: number[];
  tokens_daily30_out?: number[];
  tools_used: Record<string, number>;
  skills_invoked: Record<string, number>;
  subagent_count?: number;
  subagent_active?: number;
  top_subagents?: Subagent[];
  top_realms?: Realm[];
};

function TrendBadge({ curr, prev }: { curr: number; prev: number }) {
  if (curr === 0 && prev === 0) {
    return <span className="text-[10px] text-slate-700">—</span>;
  }
  if (prev === 0 && curr > 0) {
    return (
      <span className="text-[10px] text-emerald-400 font-medium" title={`new: +${curr}`}>
        ▲ new
      </span>
    );
  }
  if (curr === 0 && prev > 0) {
    return (
      <span className="text-[10px] text-rose-400 font-medium" title={`-${prev} (was ${prev})`}>
        ▼ −{prev}
      </span>
    );
  }
  const delta = curr - prev;
  const pct = prev > 0 ? Math.round((delta / prev) * 100) : 0;
  if (delta === 0) {
    return <span className="text-[10px] text-slate-500" title="no change">＝</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`text-[10px] font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}
      title={`this 7d: ${curr} · prev 7d: ${prev} (${up ? '+' : ''}${pct}%)`}
    >
      {up ? '▲' : '▼'} {up ? '+' : ''}{pct}%
    </span>
  );
}

function MiniSpark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 56;
  const h = 18;
  const n = values.length;
  if (n === 0) return null;
  const pts = values
    .map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - (v / max) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="#fbbf24"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.85}
      />
      {values[n - 1] > 0 && (
        <circle
          cx={w}
          cy={h - (values[n - 1] / max) * h}
          r={1.6}
          fill="#fbbf24"
        />
      )}
    </svg>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function BarList({
  entries,
  max,
  color,
  onClick,
}: {
  entries: [string, number][];
  max: number;
  color: string;
  onClick?: (key: string) => void;
}) {
  const { t, fmt } = useT();
  if (entries.length === 0) {
    return <div className="text-xs text-slate-600 text-center py-4">{t('misc.none')}</div>;
  }
  return (
    <ul className="divide-y divide-slate-800/60">
      {entries.map(([k, v]) => {
        const row = (
          <>
            <span className="font-mono text-slate-200 w-40 truncate text-left">{k}</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} />
            </div>
            <span className="text-slate-400 tabular-nums w-14 text-right">×{fmt(v)}</span>
          </>
        );
        return (
          <li key={k}>
            {onClick ? (
              <button
                type="button"
                onClick={() => onClick(k)}
                className="w-full px-4 py-2 flex items-center gap-3 text-sm hover:bg-slate-800/40 transition-colors text-left"
              >
                {row}
              </button>
            ) : (
              <div className="px-4 py-2 flex items-center gap-3 text-sm">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const AGENT_COLORS: Record<string, string> = {
  copilot: '#34d399',
  claude: '#a78bfa',
  codex: '#f59e0b',
};

function AgentDonut({ entries }: { entries: [string, number][] }) {
  const { t } = useT();
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total === 0) {
    return <div className="text-xs text-slate-600 py-6 text-center">{t('misc.no_agents')}</div>;
  }
  const radius = 60;
  const stroke = 18;
  const cx = 80;
  const cy = 80;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const segments = entries.map(([name, v]) => {
    const frac = v / total;
    const length = circ * frac;
    const seg = {
      name,
      v,
      frac,
      color: AGENT_COLORS[name] ?? '#64748b',
      dasharray: `${length} ${circ - length}`,
      dashoffset: -offset,
    };
    offset += length;
    return seg;
  });
  const top = entries[0];

  return (
    <div className="flex items-center gap-5 px-4 py-4">
      <svg width="160" height="160" viewBox="0 0 160 160" className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgb(30 41 59 / 0.7)" strokeWidth={stroke} />
        {segments.map(s => (
          <circle
            key={s.name}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.dashoffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.3s, stroke-dashoffset 0.3s' }}
          >
            <title>{`${s.name}: ${s.v} (${(s.frac * 100).toFixed(0)}%)`}</title>
          </circle>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-100 font-semibold" fontSize="22">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-slate-500" fontSize="10">
          sessions
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm flex-1 min-w-0">
        {segments.map(s => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-slate-200 capitalize">{s.name}</span>
            <span className="text-slate-500 text-xs ml-auto tabular-nums">
              {s.v}
              <span className="text-slate-600"> · {(s.frac * 100).toFixed(0)}%</span>
            </span>
          </li>
        ))}
        {top && (
          <li className="text-[10px] text-slate-600 pt-1 border-t border-slate-800/60 mt-2">
            top: {top[0]}
          </li>
        )}
      </ul>
    </div>
  );
}

function WeekGrid({ grid }: { grid: number[][] }) {
  const { t, fmt, lang } = useT();
  const flat = grid.flat();
  const total = flat.reduce((a, b) => a + b, 0);
  const max = flat.reduce((a, b) => Math.max(a, b), 0);

  const intensity = (v: number): string => {
    if (v === 0) return 'bg-slate-800/60';
    const r = max > 0 ? v / max : 0;
    if (r < 0.2) return 'bg-emerald-900/70';
    if (r < 0.4) return 'bg-emerald-800';
    if (r < 0.6) return 'bg-emerald-600';
    if (r < 0.8) return 'bg-emerald-500';
    return 'bg-emerald-400';
  };

  const dayLabel = (daysAgo: number): string => {
    if (daysAgo === 0) return lang === 'zh' ? '今天' : 'Today';
    if (daysAgo === 1) return lang === 'zh' ? '昨天' : 'Yest';
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' });
  };

  // grid[0] = today, render today at the bottom for natural reading
  const rows = grid.map((row, i) => ({ daysAgo: i, row })).reverse();

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">{lang === 'zh' ? '7 天 × 24 小时活跃度' : '7 days × 24h activity'}</h3>
        <span className="text-[11px] text-slate-500">{fmt(total)} {t('misc.events')}</span>
      </header>
      <div className="p-4">
        <div className="flex">
          <div className="flex flex-col justify-between mr-2 text-[10px] text-slate-500 leading-none">
            {rows.map(({ daysAgo }) => (
              <div key={daysAgo} className="h-5 flex items-center">{dayLabel(daysAgo)}</div>
            ))}
          </div>
          <div className="flex-1">
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0,1fr))' }}>
              {rows.flatMap(({ daysAgo, row }) =>
                row.map((v, h) => (
                  <div
                    key={`${daysAgo}-${h}`}
                    title={`${dayLabel(daysAgo)} ${String(h).padStart(2, '0')}:00 · ${fmt(v)} ${t('misc.events')}`}
                    className={`h-5 rounded-sm ${intensity(v)} hover:ring-1 hover:ring-slate-500 transition`}
                  />
                ))
              )}
            </div>
            <div className="mt-2 grid text-[10px] text-slate-500" style={{ gridTemplateColumns: 'repeat(24, minmax(0,1fr))' }}>
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-center">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
          <span>{lang === 'zh' ? '少' : 'less'}</span>
          {['bg-slate-800/60', 'bg-emerald-900/70', 'bg-emerald-800', 'bg-emerald-600', 'bg-emerald-500', 'bg-emerald-400'].map(c => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span>{lang === 'zh' ? '多' : 'more'}</span>
        </div>
      </div>
    </section>
  );
}

function ActivityHeatmap({ buckets }: { buckets: number[] }) {
  const { t, fmt, lang } = useT();
  const total = buckets.reduce((a, b) => a + b, 0);
  const max = buckets.reduce((a, b) => Math.max(a, b), 0);
  const now = new Date();
  const startHour = (now.getHours() + 1) % 24;

  const intensity = (v: number): string => {
    if (v === 0) return 'bg-slate-800/60';
    const ratio = max > 0 ? v / max : 0;
    if (ratio < 0.25) return 'bg-emerald-900/70';
    if (ratio < 0.5) return 'bg-emerald-700';
    if (ratio < 0.75) return 'bg-emerald-500';
    return 'bg-emerald-400';
  };

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">{lang === 'zh' ? '24 小时活跃度' : '24h activity'}</h3>
        <span className="text-[11px] text-slate-500">{fmt(total)} {t('misc.events')}</span>
      </header>
      <div className="p-4">
        <div className="grid grid-cols-24 gap-1" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0,1fr))` }}>
          {buckets.map((v, i) => {
            const hour = (startHour + i) % 24;
            const hoursAgo = buckets.length - 1 - i;
            const ago = hoursAgo === 0
              ? t('misc.now')
              : (lang === 'zh' ? `${hoursAgo} 小时前` : `${hoursAgo}h ago`);
            const label = `${ago} · ${String(hour).padStart(2, '0')}:00 · ${fmt(v)} ${t('misc.events')}`;
            return (
              <div
                key={i}
                title={label}
                className={`h-8 rounded ${intensity(v)} hover:ring-1 hover:ring-slate-500 transition`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-500">
          <span>{buckets.length}h ago</span>
          <span>now</span>
        </div>
      </div>
    </section>
  );
}

function LiveTicker({ sessions, onOpen }: { sessions: Session[]; onOpen?: (id: string) => void }) {
  const { t, fmt, rel } = useT();
  if (sessions.length === 0) return null;
  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800 overflow-hidden">
      <header className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
        </span>
        <h3 className="text-xs uppercase tracking-wider text-emerald-300 font-semibold">{t('sec.live_ticker')}</h3>
        <span className="text-[11px] text-slate-500">{fmt(sessions.length)} {t('misc.active_count')}</span>
      </header>
      <div className="px-4 py-3 flex gap-3 overflow-x-auto">
        {sessions.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen?.(s.id)}
            className="flex-shrink-0 min-w-[260px] max-w-[320px] text-left rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2.5 cursor-pointer transition-colors hover:bg-slate-800/80 hover:border-emerald-500/50"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                style={{
                  background: `${AGENT_COLORS[s.agent] ?? '#64748b'}22`,
                  color: AGENT_COLORS[s.agent] ?? '#94a3b8',
                  border: `1px solid ${AGENT_COLORS[s.agent] ?? '#64748b'}55`,
                }}
              >
                {s.agent}
              </span>
              {s.model && (
                <span className="text-[10px] text-slate-500 font-mono truncate">{s.model}</span>
              )}
              <span className="ml-auto text-[10px] text-slate-500" title={new Date(s.last_event_at).toLocaleString()}>
                {rel(s.last_event_at)}
              </span>
            </div>
            <div className="text-sm text-slate-200 truncate" title={s.summary || s.id}>
              {s.summary || <span className="font-mono text-xs text-slate-500">{s.id.slice(0, 12)}</span>}
            </div>
            {(s.repo || s.branch) && (
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {s.repo && <span className="font-mono">{s.repo}</span>}
                {s.repo && s.branch && <span className="text-slate-700"> · </span>}
                {s.branch && <span className="text-slate-400">{s.branch}</span>}
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

// tickerAgo removed; replaced by useT().rel()

const AGENT_COLOR: Record<string, string> = {
  copilot: 'bg-cyan-500/80',
  claude: 'bg-amber-500/80',
  codex: 'bg-emerald-500/80',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function DormantBanner({ active, onOpen }: { active: Session[]; onOpen?: (id: string) => void }) {
  const { t } = useT();
  const [days, setDays] = useState<number>(() => {
    const v = parseInt(localStorage.getItem('pawscope.dormantDays') ?? '', 10);
    return Number.isFinite(v) && v >= 1 ? v : 3;
  });
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    localStorage.getItem('pawscope.dormantCollapsed') === '1'
  );
  useEffect(() => { localStorage.setItem('pawscope.dormantDays', String(days)); }, [days]);
  useEffect(() => { localStorage.setItem('pawscope.dormantCollapsed', collapsed ? '1' : '0'); }, [collapsed]);
  const now = Date.now();
  const dormant = useMemo(() => {
    const ms = days * 24 * 3600 * 1000;
    return active
      .map(s => ({ s, age: now - new Date(s.last_event_at).getTime() }))
      .filter(x => x.age >= ms)
      .sort((a, b) => b.age - a.age);
  }, [active, days, now]);
  if (dormant.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-900/40 bg-gradient-to-r from-amber-950/30 to-slate-900/40">
      <header className="px-4 py-2.5 flex items-center gap-3">
        <span className="text-amber-300 text-sm">⏰</span>
        <h3 className="text-xs uppercase tracking-wider text-amber-200">{t('sec.dormant')}</h3>
        <span className="text-[11px] text-amber-300/80 tabular-nums">{dormant.length} {t('misc.sessions_short')}</span>
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value, 10))}
          className="ml-auto bg-slate-800 border border-slate-700 rounded text-[11px] px-1.5 py-0.5 text-slate-300"
          onClick={e => e.stopPropagation()}
        >
          {[1, 3, 7, 14, 30].map(n => (
            <option key={n} value={n}>&gt; {n}d</option>
          ))}
        </select>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-[11px] text-slate-400 hover:text-slate-200"
        >
          {collapsed ? t('misc.show') : t('misc.hide')}
        </button>
      </header>
      {!collapsed && (
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {dormant.slice(0, 12).map(({ s, age }) => {
            const ageDays = Math.floor(age / (24 * 3600 * 1000));
            return (
              <button
                key={s.id}
                onClick={() => onOpen?.(s.id)}
                className="text-left rounded bg-slate-900/50 border border-slate-800 hover:border-amber-700/50 px-2.5 py-2 group"
              >
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className={`text-[10px] uppercase tracking-wider ${
                    s.agent === 'copilot' ? 'text-cyan-400' :
                    s.agent === 'claude' ? 'text-amber-400' : 'text-emerald-400'
                  }`}>{s.agent}</span>
                  <span className="text-[10px] text-amber-300/80 tabular-nums ml-auto">{ageDays}d idle</span>
                </div>
                <div className="text-xs text-slate-200 truncate group-hover:text-slate-50">
                  {s.summary || s.repo || s.id.slice(0, 12)}
                </div>
              </button>
            );
          })}
          {dormant.length > 12 && (
            <div className="text-[11px] text-slate-500 self-center pl-2">+{dormant.length - 12} {t('misc.more')}</div>
          )}
        </div>
      )}
    </section>
  );
}

interface Insight {
  icon: string;
  text: React.ReactNode;
  tone: 'info' | 'warn' | 'good' | 'cost';
}

function InsightsCard({
  sessions, tokensMap, hotFiles, dangerous, heartbeat, t,
}: {
  sessions: Session[];
  tokensMap: Record<string, { in: number; out: number }>;
  hotFiles: { path: string; mentions: number; sessions: number }[];
  dangerous: { tool: string; count: number; sessions: number; severity: string }[];
  heartbeat: { peak_hour: number | null; peak_dow: number | null } | null;
  t: (k: string) => string;
}) {
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];

    // === 1. Cost peak day this week ===
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayCost: number[] = new Array(7).fill(0);
    const dayLabel: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay.getTime() - i * 86400000);
      dayLabel.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    for (const s of sessions) {
      if (!s.last_event_at) continue;
      const dt = new Date(s.last_event_at);
      const sd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const diff = Math.floor((startOfDay.getTime() - sd.getTime()) / 86400000);
      if (diff < 0 || diff > 6) continue;
      const tk = tokensMap[s.id];
      if (!tk) continue;
      const c = estimateCostUsd((s as any).model, tk.in, tk.out);
      if (c === null) continue;
      dayCost[6 - diff] += c;
    }
    const totalWeek = dayCost.reduce((a, b) => a + b, 0);
    if (totalWeek > 0) {
      const maxIdx = dayCost.reduce((mi, v, i) => (v > dayCost[mi] ? i : mi), 0);
      const minIdx = dayCost.reduce((mi, v, i) => (v < dayCost[mi] && v > 0 ? i : mi), maxIdx);
      const peakCost = dayCost[maxIdx];
      const minCost = dayCost[minIdx];
      if (peakCost > 0 && minCost > 0 && maxIdx !== minIdx) {
        const ratio = peakCost / minCost;
        if (ratio >= 1.5) {
          out.push({
            icon: '💸',
            tone: 'cost',
            text: <>{t('insights.cost_peak_prefix')} <b className="text-amber-300">{dayLabel[maxIdx]}</b> {t('insights.cost_peak_mid')} <b className="text-amber-300">{ratio.toFixed(1)}×</b> {t('insights.cost_peak_suffix')} ({formatUsd(peakCost)} vs {formatUsd(minCost)}).</>,
          });
        }
      }
    }

    // === 2. Daily budget overruns ===
    const budgetRaw = parseFloat(localStorage.getItem('pawscope.dailyBudget') ?? '');
    if (Number.isFinite(budgetRaw) && budgetRaw > 0) {
      const overDays = dayCost.filter(c => c > budgetRaw).length;
      if (overDays > 0) {
        out.push({
          icon: '⚠',
          tone: 'warn',
          text: <>{t('insights.budget_prefix')} <b className="text-rose-300">{overDays}</b> {t('insights.budget_mid')} {formatUsd(budgetRaw)}.</>,
        });
      }
    }

    // === 3. Hottest file ===
    const top = hotFiles[0];
    if (top && top.sessions >= 2) {
      out.push({
        icon: '🔥',
        tone: 'info',
        text: <>{t('insights.hot_file_prefix')} <b className="text-violet-300 font-mono">{top.path}</b> {t('insights.hot_file_mid')} <b>{top.sessions}</b> {t('insights.hot_file_sessions')} · <b>{top.mentions}</b> {t('insights.hot_file_mentions')}.</>,
      });
    }

    // === 4. Dangerous tool ratio ===
    if (dangerous.length > 0) {
      const top = dangerous[0];
      out.push({
        icon: top.severity === 'high' ? '🚨' : '⚠',
        tone: 'warn',
        text: <>{t('insights.danger_prefix')} <b className="text-rose-300 font-mono">{top.tool}</b> {t('insights.danger_mid')} <b>{top.count}</b> {t('insights.danger_calls')} {t('insights.danger_across')} <b>{top.sessions}</b> {t('insights.danger_sessions')}.</>,
      });
    }

    // === 5. Peak hour pattern ===
    if (heartbeat && heartbeat.peak_hour !== null) {
      const hr = heartbeat.peak_hour;
      const band = hr < 5 ? t('insights.band_late') : hr < 12 ? t('insights.band_morning') : hr < 18 ? t('insights.band_afternoon') : t('insights.band_evening');
      out.push({
        icon: '⏰',
        tone: 'info',
        text: <>{t('insights.peak_prefix')} <b className="text-cyan-300">{String(hr).padStart(2, '0')}:00</b> ({band}).</>,
      });
    }

    // === 6. Active right now ===
    const activeNow = sessions.filter(s => s.status === 'active').length;
    if (activeNow > 0) {
      out.push({
        icon: '🟢',
        tone: 'good',
        text: <>{t('insights.active_prefix')} <b className="text-emerald-300">{activeNow}</b> {t('insights.active_suffix')}.</>,
      });
    }

    return out.slice(0, 5);
  }, [sessions, tokensMap, hotFiles, dangerous, heartbeat, t]);

  if (insights.length === 0) return null;

  const toneClass = (tone: Insight['tone']) =>
    tone === 'warn' ? 'border-rose-900/40 bg-rose-950/20'
    : tone === 'good' ? 'border-emerald-900/40 bg-emerald-950/20'
    : tone === 'cost' ? 'border-amber-900/40 bg-amber-950/20'
    : 'border-slate-800 bg-slate-900/40';

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">💡 {t('sec.insights')}</h3>
        <span className="text-[11px] text-slate-500">{insights.length}</span>
      </header>
      <ul className="divide-y divide-slate-800/40">
        {insights.map((ins, i) => (
          <li key={i} className={`px-4 py-2.5 text-xs flex items-start gap-3 border-l-2 ${toneClass(ins.tone)}`}>
            <span className="text-base leading-none mt-0.5">{ins.icon}</span>
            <span className="text-slate-200 leading-relaxed">{ins.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WordCloud({ entries, onPick }: {
  entries: { word: string; count: number; sessions: number }[];
  onPick: (w: string) => void;
}) {
  const max = entries[0]?.count ?? 1;
  const min = entries[entries.length - 1]?.count ?? 1;
  const span = Math.max(1, max - min);
  const sized = entries.map(e => {
    const t = (e.count - min) / span;
    const fontSize = 11 + t * 18;
    const opacity = 0.55 + t * 0.45;
    return { ...e, fontSize, opacity };
  });
  const palette = ['text-cyan-300', 'text-emerald-300', 'text-amber-300', 'text-violet-300', 'text-sky-300', 'text-rose-300'];
  return (
    <div className="px-4 py-4 flex flex-wrap gap-x-4 gap-y-2 items-center justify-center">
      {sized.map((e, i) => (
        <button
          key={e.word}
          onClick={() => onPick(e.word)}
          className={`${palette[i % palette.length]} hover:underline transition-opacity font-medium`}
          style={{ fontSize: `${e.fontSize}px`, opacity: e.opacity, lineHeight: 1.2 }}
          title={`${e.count} occurrences · ${e.sessions} sessions`}
        >
          {e.word}
        </button>
      ))}
    </div>
  );
}

function PromptLengthHist({ stats, t }: {
  stats: { total: number; mean: number; median: number; p95: number; p99: number; max: number;
    buckets: { label: string; min: number; max: number; count: number }[] };
  t: (k: string) => string;
}) {
  const max = Math.max(1, ...stats.buckets.map(b => b.count));
  return (
    <div className="px-4 py-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
        <Stat label="median" value={`${stats.median}`} />
        <Stat label="mean" value={stats.mean.toFixed(0)} />
        <Stat label="p95" value={`${stats.p95}`} />
        <Stat label="p99" value={`${stats.p99}`} />
        <Stat label="max" value={`${stats.max}`} />
      </div>
      <div className="flex items-end gap-1.5 h-32 pt-2">
        {stats.buckets.map(b => {
          const h = (b.count / max) * 100;
          return (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-1 group" title={`${b.count} prompts (${b.min}-${b.max === Number.MAX_SAFE_INTEGER || b.max > 1e10 ? '∞' : b.max} chars)`}>
              <div className="text-[10px] text-slate-500 group-hover:text-slate-300 tabular-nums">{b.count || ''}</div>
              <div
                className="w-full rounded-t bg-gradient-to-t from-cyan-700/60 to-cyan-400/80 hover:from-cyan-600/80 hover:to-cyan-300 transition-colors"
                style={{ height: `${Math.max(2, h)}%` }}
              />
              <div className="text-[10px] text-slate-500 tabular-nums">{b.label}</div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-600 text-center">{t('misc.length_chars')}</div>
    </div>
  );
}

function TechStack({ entries, t }: {
  entries: { key: string; label: string; icon: string; hits: number; sessions: number }[];
  t: (k: string) => string;
}) {
  if (!entries.length) return null;
  const maxSess = Math.max(1, ...entries.map(e => e.sessions));
  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap gap-2">
        {entries.map(e => {
          const intensity = 0.3 + (e.sessions / maxSess) * 0.7;
          return (
            <div
              key={e.key}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 bg-slate-800/40 hover:border-cyan-500/60 transition-colors"
              style={{ opacity: intensity }}
              title={`${e.sessions} sessions, ${e.hits} mentions`}
            >
              <span>{e.icon}</span>
              <span className="text-[12px] font-medium text-slate-200">{e.label}</span>
              <span className="text-[10px] text-slate-500 tabular-nums">{e.sessions}</span>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-600 mt-2">{t('misc.detected_from_prompts')}</div>
    </div>
  );
}

function WeeklyTrendChart({ data, t }: {
  data: {
    weeks: { label: string; days: number[] }[];
    total_this_week: number;
    total_last_week: number;
    delta_pct: number;
  };
  t: (k: string) => string;
}) {
  const allVals = data.weeks.flatMap(w => w.days);
  const max = Math.max(1, ...allVals);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const W = 280, H = 90, padX = 24, padY = 8;
  const stepX = (W - padX * 2) / 6;
  const colors = ['#22d3ee', '#94a3b8', '#64748b', '#475569'];
  const pathFor = (vals: number[]) => vals.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (1 - v / max) * (H - padY * 2);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const delta = data.delta_pct;
  const deltaColor = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-400';
  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-center gap-4 text-[11px]">
        <div>
          <span className="text-slate-500">{t('misc.this_week')}: </span>
          <span className="text-cyan-300 font-semibold tabular-nums">{data.total_this_week}</span>
        </div>
        <div>
          <span className="text-slate-500">{t('misc.last_week')}: </span>
          <span className="text-slate-300 tabular-nums">{data.total_last_week}</span>
        </div>
        <div className={`${deltaColor} font-medium tabular-nums`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24">
        {[0, 0.5, 1].map((f, i) => (
          <line key={i} x1={padX} y1={padY + f * (H - padY * 2)} x2={W - padX} y2={padY + f * (H - padY * 2)} stroke="#1e293b" strokeWidth="0.5"/>
        ))}
        {data.weeks.slice().reverse().map((w, idx) => {
          const realIdx = data.weeks.length - 1 - idx;
          const isThis = realIdx === 0;
          return (
            <path
              key={w.label}
              d={pathFor(w.days)}
              fill="none"
              stroke={colors[realIdx] ?? '#475569'}
              strokeWidth={isThis ? 2 : 1}
              strokeDasharray={isThis ? '0' : '3,2'}
              opacity={isThis ? 1 : 0.6}
            />
          );
        })}
        {data.weeks[0]?.days.map((v, i) => {
          const x = padX + i * stepX;
          const y = padY + (1 - v / max) * (H - padY * 2);
          return <circle key={i} cx={x} cy={y} r="2.5" fill="#22d3ee" />;
        })}
        {dayLabels.map((d, i) => (
          <text key={d} x={padX + i * stepX} y={H - 1} fontSize="8" fill="#64748b" textAnchor="middle">{d}</text>
        ))}
      </svg>
    </div>
  );
}

function HeartbeatHeatmap({ data, t }: {
  data: { grid: number[][]; days: string[]; by_hour: number[]; peak_hour: number; peak_dow: number; total: number };
  t: (k: string) => string;
}) {
  const flat = data.grid.flat();
  const max = Math.max(1, ...flat);
  const fmtHr = (h: number) => `${h.toString().padStart(2, '0')}:00`;
  const peakDow = data.peak_dow;
  const peakHr = data.peak_hour;
  const tip = (() => {
    const isWeekend = peakDow === 5 || peakDow === 6;
    let timeBand: string;
    let advice: string;
    if (peakHr >= 5 && peakHr < 11) { timeBand = t('tip.morning'); advice = t('tip.morning_advice'); }
    else if (peakHr >= 11 && peakHr < 14) { timeBand = t('tip.midday'); advice = t('tip.midday_advice'); }
    else if (peakHr >= 14 && peakHr < 18) { timeBand = t('tip.afternoon'); advice = t('tip.afternoon_advice'); }
    else if (peakHr >= 18 && peakHr < 23) { timeBand = t('tip.evening'); advice = t('tip.evening_advice'); }
    else { timeBand = t('tip.night'); advice = t('tip.night_advice'); }
    const wkPart = isWeekend ? t('tip.weekend') : t('tip.weekday');
    return { band: `${wkPart} · ${timeBand}`, advice };
  })();
  return (
    <div className="px-4 py-4 space-y-3">
      <div className="text-[11px] text-slate-400">
        {t('misc.peak_at')}{' '}
        <span className="text-cyan-300 font-semibold">{data.days[data.peak_dow]} {fmtHr(data.peak_hour)}</span>
        {' · '}
        <span className="text-slate-500">{data.total} {t('misc.prompts')}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-grid" style={{ gridTemplateColumns: 'auto repeat(24, minmax(12px, 1fr))', gap: '2px' }}>
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[8px] text-slate-600 text-center tabular-nums">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
          {data.days.map((day, d) => (
            <Fragment key={`row-${d}`}>
              <div className="text-[10px] text-slate-500 pr-1 self-center">{day}</div>
              {data.grid[d].map((c, h) => {
                const intensity = c / max;
                return (
                  <div
                    key={`${d}-${h}`}
                    className="aspect-square rounded-sm"
                    style={{
                      background: c === 0
                        ? 'rgba(30,41,59,0.4)'
                        : `rgba(34,211,238,${0.2 + intensity * 0.8})`,
                    }}
                    title={`${day} ${fmtHr(h)} · ${c} prompts`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] flex items-start gap-2">
        <span className="text-cyan-300">💡</span>
        <div className="flex-1 leading-relaxed">
          <span className="text-cyan-300 font-semibold">{tip.band}</span>
          <span className="text-slate-400"> · {tip.advice}</span>
        </div>
      </div>
    </div>
  );
}

function DangerousTools({ data, t, onOpenSession }: {
  data: { entries: { name: string; severity: string; count: number; sessions: number; session_ids: string[] }[]; total_calls: number; sessions_affected: number };
  t: (k: string) => string;
  onOpenSession?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (data.entries.length === 0) {
    return <div className="px-4 py-6 text-xs text-slate-600 text-center">{t('misc.no_dangerous')}</div>;
  }
  const sevColor: Record<string, string> = {
    high: 'border-rose-500/60 bg-rose-500/10 text-rose-300',
    medium: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
    low: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  };
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="text-[11px] text-slate-400">
        {data.total_calls} {t('misc.calls')} · {data.sessions_affected} {t('misc.sessions_affected')}
      </div>
      <ul className="divide-y divide-slate-800/60">
        {data.entries.slice(0, 10).map(e => {
          const isOpen = expanded === e.name;
          return (
            <li key={e.name} className="py-1">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : e.name)}
                className="w-full flex items-center gap-2 text-xs hover:bg-slate-800/40 rounded px-1 py-1 transition-colors"
              >
                <span className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider font-semibold ${sevColor[e.severity] ?? sevColor.low}`}>
                  {e.severity}
                </span>
                <span className="font-mono text-slate-200 truncate flex-1 text-left">{e.name}</span>
                <span className="text-slate-500 tabular-nums">{e.sessions}s</span>
                <span className="text-slate-300 tabular-nums w-14 text-right">×{e.count}</span>
                <span className="text-slate-600 text-[10px] w-3">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="ml-8 mr-1 mb-1 mt-1 flex flex-wrap gap-1">
                  {e.session_ids.length === 0 && (
                    <span className="text-[10px] text-slate-600">{t('misc.no_sessions')}</span>
                  )}
                  {e.session_ids.map(id => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onOpenSession?.(id)}
                      className="px-1.5 py-0.5 rounded bg-slate-800/70 hover:bg-cyan-500/20 text-[10px] font-mono text-slate-400 hover:text-cyan-300 transition-colors"
                      title={id}
                    >
                      {id.slice(0, 8)}
                    </button>
                  ))}
                  {e.sessions > e.session_ids.length && (
                    <span className="px-1.5 py-0.5 text-[10px] text-slate-600">+{e.sessions - e.session_ids.length} more</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HotFiles({ files, t, onClick, onOpenSession }: {
  files: { path: string; mentions: number; sessions: number; samples?: { session_id: string; snippet: string }[] }[];
  t: (k: string) => string;
  onClick?: (path: string) => void;
  onOpenSession?: (sid: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (files.length === 0) {
    return <div className="px-4 py-6 text-xs text-slate-600 text-center">{t('misc.no_hot_files')}</div>;
  }
  const max = Math.max(1, ...files.map(f => f.sessions));
  return (
    <ul className="divide-y divide-slate-800/60 max-h-72 overflow-auto">
      {files.slice(0, 20).map(f => {
        const pct = (f.sessions / max) * 100;
        const isOpen = expanded === f.path;
        const hasSamples = (f.samples?.length ?? 0) > 0;
        return (
          <li key={f.path}>
            <div className="w-full px-4 py-1.5 flex items-center gap-2 text-xs hover:bg-slate-800/40 transition-colors">
              <button
                type="button"
                onClick={() => onClick?.(f.path)}
                className="font-mono text-slate-300 truncate flex-1 text-left hover:text-cyan-300"
                title={`${t('misc.search_for')} ${f.path}`}
              >{f.path}</button>
              <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500/70 to-violet-400" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-slate-400 tabular-nums w-12 text-right">{f.sessions}s · {f.mentions}</span>
              {hasSamples && (
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : f.path)}
                  className="text-slate-500 hover:text-slate-200 px-1"
                  title={t('misc.show_samples')}
                >{isOpen ? '▾' : '▸'}</button>
              )}
            </div>
            {isOpen && hasSamples && (
              <div className="px-4 pb-2 pt-0.5 space-y-1 bg-slate-900/40">
                {f.samples!.map((sm, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenSession?.(sm.session_id)}
                    className="block w-full text-left text-[11px] text-slate-400 hover:text-cyan-300 italic leading-snug"
                    title={sm.session_id}
                  >
                    <span className="text-slate-600 not-italic mr-1.5 font-mono">{sm.session_id.slice(0, 8)}</span>
                    "{sm.snippet}"
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-800/40 border border-slate-800 px-2 py-1.5 flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-cyan-300 tabular-nums font-medium">{value}</span>
    </div>
  );
}

function TokenUsageSection({
  tokensIn,
  tokensOut,
  byAgent,
  daily7In,
  daily7Out,
  daily30In,
  daily30Out,
}: {
  tokensIn: number;
  tokensOut: number;
  byAgent: Record<string, { in: number; out: number }>;
  daily7In: number[];
  daily7Out: number[];
  daily30In: number[];
  daily30Out: number[];
}) {
  const { t } = useT();
  const total = tokensIn + tokensOut;
  const [range, setRange] = useState<7 | 30>(7);
  const entries = Object.entries(byAgent)
    .map(([name, v]) => ({ name, total: v.in + v.out, in: v.in, out: v.out }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);

  const activeIn = range === 30 ? daily30In : daily7In;
  const activeOut = range === 30 ? daily30Out : daily7Out;
  const days = Math.max(activeIn.length, activeOut.length);
  const dayMax = Math.max(
    1,
    ...Array.from({ length: days }, (_, i) => (activeIn[i] ?? 0) + (activeOut[i] ?? 0)),
  );
  const dayLabels = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  });

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.token_usage')}</h3>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {fmtTokens(tokensIn)} {t('misc.token_in_arrow')} · {fmtTokens(tokensOut)} {t('misc.token_out_arrow')} · <span className="text-slate-300">{fmtTokens(total)}</span>
        </span>
      </header>
      <div className="px-4 py-4 space-y-4">
        {/* Stacked bar by agent */}
        <div className="flex h-6 rounded-md overflow-hidden bg-slate-950/50 border border-slate-800/60">
          {entries.map((e) => {
            const pct = (e.total / total) * 100;
            return (
              <div
                key={e.name}
                className={`${AGENT_COLOR[e.name] ?? 'bg-slate-500/70'} h-full`}
                style={{ width: `${pct}%` }}
                title={`${e.name}: ${fmtTokens(e.total)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        {/* Per-agent breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {entries.map((e) => {
            const pct = (e.total / total) * 100;
            return (
              <div key={e.name} className="rounded-md bg-slate-950/40 border border-slate-800/60 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${AGENT_COLOR[e.name] ?? 'bg-slate-500/70'}`} />
                  <span className="font-medium capitalize">{e.name}</span>
                  <span className="ml-auto text-[10px] text-slate-500 tabular-nums">{pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-100 tabular-nums">{fmtTokens(e.total)}</div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {fmtTokens(e.in)} ↑ · {fmtTokens(e.out)} ↓
                </div>
              </div>
            );
          })}
        </div>
        {/* Token trend chart with range toggle */}
        {days > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{t('sec.token_trend7')}</span>
                <div className="flex rounded overflow-hidden border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setRange(7)}
                    className={`px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                      range === 7 ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >7D</button>
                  <button
                    type="button"
                    onClick={() => setRange(30)}
                    className={`px-1.5 py-0.5 text-[9px] font-medium transition-colors border-l border-slate-700 ${
                      range === 30 ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >30D</button>
                </div>
              </div>
              <span className="text-[10px] text-slate-600 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />
                  {t('misc.token_in_arrow')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-violet-500/70" />
                  {t('misc.token_out_arrow')}
                </span>
              </span>
            </div>
            <div className={`flex items-end ${range === 30 ? 'gap-0.5' : 'gap-1.5'} h-24`}>
              {Array.from({ length: days }).map((_, i) => {
                const inv = activeIn[i] ?? 0;
                const outv = activeOut[i] ?? 0;
                const tot = inv + outv;
                const inPct = tot === 0 ? 0 : (inv / dayMax) * 100;
                const outPct = tot === 0 ? 0 : (outv / dayMax) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col-reverse h-20 rounded-sm overflow-hidden bg-slate-950/40 border border-slate-800/40 relative">
                      <div
                        className="bg-emerald-500/70 group-hover:bg-emerald-400/80 transition-colors"
                        style={{ height: `${inPct}%` }}
                      />
                      <div
                        className="bg-violet-500/70 group-hover:bg-violet-400/80 transition-colors"
                        style={{ height: `${outPct}%` }}
                      />
                      {tot > 0 && (
                        <div className="absolute inset-x-0 -top-5 text-center text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums whitespace-nowrap">
                          {fmtTokens(tot)}
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-500 tabular-nums">
                      {range === 30 ? (i % 5 === 0 ? dayLabels[i] : '') : dayLabels[i]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function OverviewPanel({
  onOpenSession,
  onOpenRealm,
  onOpenSkill,
  onOpenCategory,
  onOpenSearch,
}: {
  onOpenSession?: (id: string) => void;
  onOpenRealm?: (name: string) => void;
  onOpenSkill?: (name: string) => void;
  onOpenCategory?: (name: string) => void;
  onOpenSearch?: (q: string) => void;
} = {}) {
  const { t, lang, fmt } = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<number[] | null>(null);
  const [grid, setGrid] = useState<number[][] | null>(null);
  const [active, setActive] = useState<Session[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [tokensMap, setTokensMap] = useState<Record<string, { in: number; out: number }>>({});
  const [allSkills, setAllSkills] = useState<SkillEntry[] | null>(null);
  const [wordcloud, setWordcloud] = useState<{ word: string; count: number; sessions: number }[]>([]);
  const [promptLen, setPromptLen] = useState<{
    total: number; mean: number; median: number; p95: number; p99: number; max: number;
    buckets: { label: string; min: number; max: number; count: number }[];
  } | null>(null);
  const [techStack, setTechStack] = useState<{
    key: string; label: string; icon: string; hits: number; sessions: number;
  }[]>([]);
  const [weekly, setWeekly] = useState<{
    weeks: { label: string; days: number[] }[];
    total_this_week: number; total_last_week: number; delta_pct: number;
  } | null>(null);
  const [heartbeat, setHeartbeat] = useState<{
    grid: number[][]; days: string[]; by_hour: number[]; by_dow: number[];
    peak_hour: number; peak_dow: number; total: number;
  } | null>(null);
  const [dangerous, setDangerous] = useState<{
    entries: { name: string; severity: string; count: number; sessions: number; session_ids: string[] }[];
    total_calls: number; sessions_affected: number;
  } | null>(null);
  const [hotFiles, setHotFiles] = useState<{ path: string; mentions: number; sessions: number; samples?: { session_id: string; snippet: string }[] }[]>([]);
  const [, forceTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchOverview()
        .then(d => !cancelled && setData(d))
        .catch(e => !cancelled && setErr(String(e)));
      fetchActivity()
        .then(d => !cancelled && setActivity(d.buckets ?? []))
        .catch(() => {});
      fetchActivityGrid()
        .then(d => !cancelled && setGrid(d.grid ?? null))
        .catch(() => {});
      fetchSkills()
        .then(d => !cancelled && setAllSkills(d.skills ?? []))
        .catch(() => {});
    };
    const loadActive = () => {
      fetchSessions()
        .then((s: Session[]) => {
          if (cancelled) return;
          setActive(s.filter(x => x.status === 'active'));
          setAllSessions(s);
        })
        .catch(() => {});
      fetch('/api/sessions/tokens')
        .then(r => r.ok ? r.json() : {})
        .then(d => { if (!cancelled) setTokensMap(d); })
        .catch(() => {});
      fetch('/api/prompts/wordcloud?top=80')
        .then(r => r.ok ? r.json() : [])
        .then(d => { if (!cancelled) setWordcloud(Array.isArray(d) ? d : []); })
        .catch(() => {});
      fetch('/api/prompts/length')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setPromptLen(d); })
        .catch(() => {});
      fetch('/api/prompts/techstack')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setTechStack(d.entries ?? []); })
        .catch(() => {});
      fetch('/api/activity/weekly?weeks=2')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setWeekly(d); })
        .catch(() => {});
      fetch('/api/activity/heartbeat')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setHeartbeat(d); })
        .catch(() => {});
      fetch('/api/tools/dangerous')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setDangerous(d); })
        .catch(() => {});
      fetch('/api/files/hot')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && Array.isArray(d)) setHotFiles(d); })
        .catch(() => {});
    };
    load();
    loadActive();
    // Slow polling as safety net only — SSE drives realtime updates.
    const t = setInterval(load, 30000);
    const tick = setInterval(() => forceTick(v => v + 1), 1000);
    const unsub = subscribeEvents(ev => {
      if (cancelled) return;
      if (ev.kind === 'session_list_changed' || ev.kind === 'closed') {
        loadActive();
        load();
      } else if (ev.kind === 'detail_updated') {
        loadActive();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(tick);
      unsub();
    };
  }, []);

  const categoryStats = useMemo(() => {
    if (!allSkills) return [];
    const byCat: Record<string, { invocations: number; count: number; used: number }> = {};
    for (const s of allSkills) {
      const c = categorize(s.name);
      if (!byCat[c]) byCat[c] = { invocations: 0, count: 0, used: 0 };
      byCat[c].invocations += s.invocations;
      byCat[c].count += 1;
      if (s.invocations > 0) byCat[c].used += 1;
    }
    const order = (n: string) => {
      const i = CATEGORY_ORDER.indexOf(n);
      return i === -1 ? 9999 : i;
    };
    return Object.entries(byCat)
      .filter(([, v]) => v.invocations > 0)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.invocations - a.invocations || order(a.name) - order(b.name));
  }, [allSkills]);

  // Aggregate cost across sessions using their model + token totals.
  // MUST be declared before any conditional early-return below to keep hook order stable.
  const costStats = useMemo(() => {
    let total = 0;
    let unknownTokens = 0;
    let knownSessions = 0;
    let unknownSessions = 0;
    const byAgent: Record<string, number> = {};
    const byModel: Record<string, { cost: number; sessions: number }> = {};
    for (const s of allSessions) {
      const tk = tokensMap[s.id];
      if (!tk || (tk.in === 0 && tk.out === 0)) continue;
      const cost = estimateCostUsd(s.model, tk.in, tk.out);
      if (cost === null) {
        unknownTokens += tk.in + tk.out;
        unknownSessions++;
        continue;
      }
      total += cost;
      knownSessions++;
      byAgent[s.agent] = (byAgent[s.agent] ?? 0) + cost;
      const label = priceFor(s.model)?.label ?? s.model ?? 'unknown';
      if (!byModel[label]) byModel[label] = { cost: 0, sessions: 0 };
      byModel[label].cost += cost;
      byModel[label].sessions++;
    }
    const modelEntries = Object.entries(byModel)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.cost - a.cost);
    return { total, unknownTokens, knownSessions, unknownSessions, byAgent, modelEntries };
  }, [allSessions, tokensMap]);

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;
  if (!data) return <OverviewSkeleton />;

  const tools = Object.entries(data.tools_used).sort((a, b) => b[1] - a[1]);
  const skills = Object.entries(data.skills_invoked).sort((a, b) => b[1] - a[1]);
  const repos = Object.entries(data.by_repo).sort((a, b) => b[1] - a[1]);
  const agents = Object.entries(data.by_agent).sort((a, b) => b[1] - a[1]);
  const toolsMax = tools[0]?.[1] ?? 0;
  const skillsMax = skills[0]?.[1] ?? 0;
  const reposMax = repos[0]?.[1] ?? 0;
  const totalTools = tools.reduce((a, [, v]) => a + v, 0);

  const categoryTotal = categoryStats.reduce((a, b) => a + b.invocations, 0);

  const buildDigest = (period: 'day' | 'week'): string => {
    const now = new Date();
    const cutoff =
      period === 'day'
        ? new Date(now.getTime() - 24 * 3600_000)
        : new Date(now.getTime() - 7 * 24 * 3600_000);
    const inRange = allSessions.filter(s => {
      const ts = s.last_event_at ? new Date(s.last_event_at).getTime() : 0;
      return ts >= cutoff.getTime();
    });
    const lines: string[] = [];
    const title = period === 'day' ? 'Daily Digest' : 'Weekly Digest';
    lines.push(`# Pawscope · ${title}`);
    lines.push('');
    lines.push(`_Generated: ${now.toISOString()}_`);
    lines.push(`_Window: last ${period === 'day' ? '24h' : '7d'}_`);
    lines.push('');
    lines.push('## Activity');
    lines.push(`- Sessions in window: **${inRange.length}**`);
    lines.push(`- Total sessions tracked: ${data.total_sessions}`);
    lines.push(`- Active now: ${data.active_sessions}`);
    lines.push(`- Total turns: ${data.total_turns.toLocaleString()}`);
    lines.push(`- Total tool calls: ${totalTools.toLocaleString()}`);
    lines.push('');
    if (costStats.total > 0 || costStats.unknownSessions > 0) {
      lines.push('## Cost');
      lines.push(`- Estimated total: **${formatUsd(costStats.total)}**`);
      lines.push(`- Sessions with known model: ${costStats.knownSessions}`);
      if (costStats.unknownSessions > 0) {
        lines.push(`- Sessions with unknown model: ${costStats.unknownSessions} (${costStats.unknownTokens.toLocaleString()} tokens)`);
      }
      if (costStats.modelEntries.length > 0) {
        lines.push('');
        lines.push('### Top models by cost');
        for (const m of costStats.modelEntries.slice(0, 5)) {
          lines.push(`- \`${m.name}\` — ${formatUsd(m.cost)} across ${m.sessions} session(s)`);
        }
      }
      lines.push('');
    }
    if (hotFiles.length > 0) {
      lines.push('## Hot files');
      for (const f of hotFiles.slice(0, 10)) {
        lines.push(`- \`${f.path}\` — ${f.mentions} mentions across ${f.sessions} session(s)`);
      }
      lines.push('');
    }
    if (dangerous && dangerous.entries.length > 0) {
      lines.push('## Dangerous tools');
      lines.push(`_${dangerous.total_calls} calls across ${dangerous.sessions_affected} sessions_`);
      lines.push('');
      for (const e of dangerous.entries.slice(0, 10)) {
        lines.push(`- **${e.name}** [${e.severity}] — ${e.count} call(s) in ${e.sessions} session(s)`);
      }
      lines.push('');
    }
    if (tools.length > 0) {
      lines.push('## Top tools');
      for (const [name, n] of tools.slice(0, 10)) lines.push(`- \`${name}\` — ${n}`);
      lines.push('');
    }
    if (skills.length > 0) {
      lines.push('## Top skills');
      for (const [name, n] of skills.slice(0, 10)) lines.push(`- \`${name}\` — ${n}`);
      lines.push('');
    }
    if (heartbeat) {
      const peakHr = heartbeat.peak_hour;
      let band = 'late night';
      let advice = '';
      if (peakHr >= 5 && peakHr < 11) { band = 'morning'; advice = 'Best for deep work and planning.'; }
      else if (peakHr >= 11 && peakHr < 14) { band = 'midday'; advice = 'Use for review and quick fixes.'; }
      else if (peakHr >= 14 && peakHr < 18) { band = 'afternoon'; advice = 'Good for execution and pairing.'; }
      else if (peakHr >= 18 && peakHr < 23) { band = 'evening'; advice = 'Good for exploration; watch for fatigue.'; }
      else { band = 'late night'; advice = 'Consider sleeping. Future-you will thank you.'; }
      lines.push('## Tip of the moment');
      lines.push(`_Peak hour: ${String(peakHr).padStart(2, '0')}:00 (${band})_  `);
      lines.push(advice);
      lines.push('');
    }
    lines.push('---');
    lines.push('_Generated by Pawscope_');
    return lines.join('\n');
  };

  const downloadDigest = (period: 'day' | 'week') => {
    const md = buildDigest(period);
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pawscope-${period}-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-6 pb-5 border-b border-slate-800 bg-slate-900/30 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{t('overview.kicker')}</div>
          <h1 className="text-2xl font-semibold text-slate-100">{t('overview.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadDigest('day')}
            title={t('overview.export_day_tip')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100 hover:border-emerald-500/50 transition-colors"
          >
            📥 {t('overview.export_day')}
          </button>
          <button
            onClick={() => downloadDigest('week')}
            title={t('overview.export_week_tip')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100 hover:border-emerald-500/50 transition-colors"
          >
            📥 {t('overview.export_week')}
          </button>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <LiveTicker sessions={active} onOpen={onOpenSession} />
        <DormantBanner active={active} onOpen={onOpenSession} />
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label={t('stat.sessions')} value={data.total_sessions} />
          <HeroStat
            label={t('stat.active')}
            value={data.active_sessions}
            accent={data.active_sessions > 0 ? 'text-emerald-300' : 'text-slate-100'}
          />
          <HeroStat label={t('stat.turns')} value={data.total_turns.toLocaleString()} />
          <HeroStat label={t('stat.tool_calls')} value={totalTools.toLocaleString()} />
        </section>

        <InsightsCard
          sessions={allSessions}
          tokensMap={tokensMap}
          hotFiles={hotFiles}
          dangerous={(dangerous?.entries ?? []).map(e => ({ tool: e.name, count: e.count, sessions: e.sessions, severity: e.severity }))}
          heartbeat={heartbeat as any}
          t={t}
        />

        {((data.total_tokens_in ?? 0) + (data.total_tokens_out ?? 0)) > 0 && (
          <TokenUsageSection
            tokensIn={data.total_tokens_in ?? 0}
            tokensOut={data.total_tokens_out ?? 0}
            byAgent={data.tokens_by_agent ?? {}}
            daily7In={data.tokens_daily7_in ?? []}
            daily7Out={data.tokens_daily7_out ?? []}
            daily30In={data.tokens_daily30_in ?? []}
            daily30Out={data.tokens_daily30_out ?? []}
          />
        )}

        {(costStats.total > 0 || costStats.unknownSessions > 0) && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.cost_summary')}</h3>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {costStats.knownSessions} {t('misc.sessions_priced')}
                {costStats.unknownSessions > 0 && ` · ${costStats.unknownSessions} ${t('misc.sessions_unpriced')}`}
              </span>
            </header>
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold text-amber-300 tabular-nums">{formatUsd(costStats.total)}</span>
                <span className="text-xs text-slate-500">{t('misc.total_estimated')}</span>
              </div>
              {costStats.modelEntries.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {costStats.modelEntries.slice(0, 6).map(m => {
                    const pct = costStats.total > 0 ? (m.cost / costStats.total) * 100 : 0;
                    return (
                      <div key={m.name} className="rounded-md bg-slate-950/40 border border-slate-800/60 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs text-slate-300">
                          <span className="font-medium truncate">{m.name}</span>
                          <span className="ml-auto text-[10px] text-slate-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="mt-1 flex items-baseline justify-between">
                          <span className="text-sm font-semibold text-amber-200 tabular-nums">{formatUsd(m.cost)}</span>
                          <span className="text-[10px] text-slate-500">{m.sessions} {t('misc.sessions_short')}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {costStats.unknownSessions > 0 && (
                <p className="text-[11px] text-slate-500">
                  {t('misc.unpriced_note').replace('{N}', String(costStats.unknownSessions))}
                </p>
              )}
            </div>
          </section>
        )}

        {activity && <ActivityHeatmap buckets={activity} />}
        {grid && <WeekGrid grid={grid} />}

        {categoryStats.length > 0 && (
          <CategoryDonut
            stats={categoryStats}
            total={categoryTotal}
            lang={lang}
            fmt={fmt}
            onPick={onOpenCategory}
            getLabel={(name: string) => categoryLabel(name, lang === 'zh' ? 'zh' : 'en')}
          />
        )}

        {wordcloud.length > 0 && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.prompt_cloud')}</h3>
              <span className="text-[11px] text-slate-500">{wordcloud.length} {t('misc.terms')}</span>
            </header>
            <WordCloud entries={wordcloud} onPick={(w) => onOpenSearch?.(w)} />
          </section>
        )}

        {promptLen && promptLen.total > 0 && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.prompt_length')}</h3>
              <span className="text-[11px] text-slate-500">{promptLen.total} {t('misc.prompts')}</span>
            </header>
            <PromptLengthHist stats={promptLen} t={t} />
          </section>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {techStack.length > 0 && (
            <div className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.tech_stack')}</h3>
                <span className="text-[11px] text-slate-500">{techStack.length} {t('misc.detected')}</span>
              </header>
              <TechStack entries={techStack} t={t} />
            </div>
          )}
          {weekly && (
            <div className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.weekly_trend')}</h3>
                <span className="text-[11px] text-slate-500">{t('misc.this_vs_last')}</span>
              </header>
              <WeeklyTrendChart data={weekly} t={t} />
            </div>
          )}
        </section>

        {heartbeat && heartbeat.total > 0 && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.heartbeat')}</h3>
              <span className="text-[11px] text-slate-500">{t('misc.dow_x_hour')}</span>
            </header>
            <HeartbeatHeatmap data={heartbeat} t={t} />
          </section>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dangerous && (
            <div className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">⚠ {t('sec.dangerous')}</h3>
                <span className="text-[11px] text-rose-400">{dangerous.entries.filter(e => e.severity === 'high').length} {t('misc.high_risk')}</span>
              </header>
              <DangerousTools data={dangerous} t={t} onOpenSession={onOpenSession} />
            </div>
          )}
          {hotFiles.length > 0 && (
            <div className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">🔥 {t('sec.hot_files')}</h3>
                <span className="text-[11px] text-slate-500">{hotFiles.length} {t('misc.files')}</span>
              </header>
              <HotFiles files={hotFiles} t={t} onClick={(p) => onOpenSearch?.(p)} onOpenSession={onOpenSession} />
            </div>
          )}
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.top_tools')}</h3>
              <span className="text-[11px] text-slate-500">{tools.length} unique</span>
            </header>
            <BarList entries={tools.slice(0, 12)} max={toolsMax} color="bg-gradient-to-r from-emerald-500/70 to-emerald-400" />
          </div>
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.top_skills')}</h3>
              <span className="text-[11px] text-slate-500">{skills.length} unique</span>
            </header>
            <BarList entries={skills.slice(0, 12)} max={skillsMax} color="bg-gradient-to-r from-sky-500/70 to-sky-400" onClick={onOpenSkill} />
          </div>
        </section>

        {data.top_subagents && data.top_subagents.length > 0 && (
          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.top_subagents')}</h3>
              <span className="text-[11px] text-slate-500">
                {data.subagent_count ?? 0} total{data.subagent_active ? ` · ${data.subagent_active} active` : ''}
              </span>
            </header>
            <ul className="divide-y divide-slate-800/60">
              {data.top_subagents.map(sa => (
                <li key={`${sa.session_id}-${sa.id}`} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${sa.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
                    title={sa.active ? 'active' : 'idle'}
                  />
                  {sa.agent_type && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-medium text-indigo-300 flex-shrink-0">
                      {sa.agent_type}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 truncate" title={sa.description || sa.id}>
                      {sa.description || <span className="font-mono text-[11px] text-slate-400">{sa.id}</span>}
                    </div>
                    <div className="font-mono text-[10px] text-slate-600 mt-0.5 truncate">
                      {sa.session_id.slice(0, 8)} · {sa.id}
                    </div>
                  </div>
                  <span className="text-slate-400 tabular-nums text-xs flex-shrink-0">
                    <span className="text-slate-500">turns</span> {sa.turns}
                  </span>
                  <span className="text-slate-400 tabular-nums text-xs flex-shrink-0">
                    <span className="text-slate-500">tools</span> {sa.tool_calls}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.top_realms && data.top_realms.length > 0 && (
          <section className="rounded-lg bg-gradient-to-br from-amber-950/30 via-slate-900/40 to-slate-900/40 border border-amber-900/30">
            <header className="px-4 py-2.5 border-b border-amber-900/30 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-amber-300 font-semibold">
                <span className="mr-1.5">👑</span> {t('sec.top_realms')}
              </h3>
              <span className="text-[11px] text-slate-500">{data.top_realms.length} ranked by turns</span>
            </header>
            <ul>
              {data.top_realms.map((r, i) => {
                const rankBadge =
                  i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                const rankColor =
                  i === 0
                    ? 'text-amber-300'
                    : i === 1
                      ? 'text-slate-300'
                      : i === 2
                        ? 'text-orange-400'
                        : 'text-slate-500';
                const isRepo = r.name.includes('/') && !r.name.startsWith('~/');
                return (
                  <li
                    key={r.name}
                    className="border-b border-slate-800/40 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenRealm?.(r.name)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-left hover:bg-amber-500/5 transition-colors cursor-pointer"
                    >
                    <span className={`tabular-nums w-8 text-center text-base ${rankColor}`}>
                      {rankBadge}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-100 font-mono text-[13px] truncate" title={r.name}>
                        {isRepo ? (
                          <>
                            <span className="text-slate-400">{r.name.split('/')[0]}/</span>
                            <span className="text-slate-100">{r.name.split('/').slice(1).join('/')}</span>
                          </>
                        ) : (
                          r.name
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {r.agents.map(a => (
                          <span
                            key={a}
                            className="w-2 h-2 rounded-full"
                            style={{ background: AGENT_COLORS[a] ?? '#64748b' }}
                            title={a}
                          />
                        ))}
                        {r.active > 0 && (
                          <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {r.active} active
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0 text-xs tabular-nums">
                      {r.daily14 && r.daily14.some(v => v > 0) && (
                        <MiniSpark values={r.daily14} />
                      )}
                      <span className="text-right">
                        <div className="text-slate-200 font-semibold">{r.sessions}</div>
                        <div className="text-[10px] text-slate-600">sessions</div>
                      </span>
                      <span className="text-right">
                        <div className="text-amber-300 font-semibold flex items-baseline justify-end gap-1.5">
                          <span>{r.turns.toLocaleString()}</span>
                          <TrendBadge curr={r.turns_this_week} prev={r.turns_prev_week} />
                        </div>
                        <div className="text-[10px] text-slate-600">turns · 7d</div>
                      </span>
                      <span className="text-right">
                        <div className="text-violet-300 font-semibold">{r.tool_calls.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-600">tools</div>
                      </span>
                    </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.top_repos')}</h3>
            </header>
            <BarList entries={repos.slice(0, 10)} max={reposMax} color="bg-gradient-to-r from-violet-500/70 to-violet-400" />
          </div>
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.agents')}</h3>
              <span className="text-[11px] text-slate-500">{agents.length} types</span>
            </header>
            <AgentDonut entries={agents} />
          </div>
        </section>

        <ToolTrend onOpenSession={onOpenSession} />

        <section className="text-[11px] text-slate-600 px-1">
          Messages: ↑ {data.total_user_messages.toLocaleString()} user · ↓ {data.total_assistant_messages.toLocaleString()} assistant
        </section>
      </div>
    </main>
  );
}

