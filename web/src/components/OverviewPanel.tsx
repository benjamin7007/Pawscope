import { useEffect, useMemo, useState } from 'react';
import { fetchOverview, fetchActivity, fetchActivityGrid, fetchSessions, fetchSkills, subscribeEvents, type SkillEntry } from '../api';
import { useT } from '../i18n';
import { categorize, CATEGORY_ORDER } from '../skillCategory';
import { CategoryDonut } from './CategoryDonut';

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

export function OverviewPanel({
  onOpenSession,
  onOpenRealm,
  onOpenSkill,
  onOpenCategory,
}: {
  onOpenSession?: (id: string) => void;
  onOpenRealm?: (name: string) => void;
  onOpenSkill?: (name: string) => void;
  onOpenCategory?: (name: string) => void;
} = {}) {
  const { t, lang, fmt } = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<number[] | null>(null);
  const [grid, setGrid] = useState<number[][] | null>(null);
  const [active, setActive] = useState<Session[]>([]);
  const [allSkills, setAllSkills] = useState<SkillEntry[] | null>(null);
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
        .then((s: Session[]) => !cancelled && setActive(s.filter(x => x.status === 'active')))
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

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;
  if (!data) return <main className="flex-1 p-8 text-slate-500 text-sm">{t('overview.aggregating')}</main>;

  const tools = Object.entries(data.tools_used).sort((a, b) => b[1] - a[1]);
  const skills = Object.entries(data.skills_invoked).sort((a, b) => b[1] - a[1]);
  const repos = Object.entries(data.by_repo).sort((a, b) => b[1] - a[1]);
  const agents = Object.entries(data.by_agent).sort((a, b) => b[1] - a[1]);
  const toolsMax = tools[0]?.[1] ?? 0;
  const skillsMax = skills[0]?.[1] ?? 0;
  const reposMax = repos[0]?.[1] ?? 0;
  const totalTools = tools.reduce((a, [, v]) => a + v, 0);

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
  const categoryTotal = categoryStats.reduce((a, b) => a + b.invocations, 0);

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-6 pb-5 border-b border-slate-800 bg-slate-900/30">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{t('overview.kicker')}</div>
        <h1 className="text-2xl font-semibold text-slate-100">{t('overview.title')}</h1>
      </header>

      <div className="p-6 space-y-6">
        <LiveTicker sessions={active} onOpen={onOpenSession} />
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

        {activity && <ActivityHeatmap buckets={activity} />}
        {grid && <WeekGrid grid={grid} />}

        {categoryStats.length > 0 && (
          <CategoryDonut
            stats={categoryStats}
            total={categoryTotal}
            lang={lang}
            fmt={fmt}
            onPick={onOpenCategory}
          />
        )}

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

        <section className="text-[11px] text-slate-600 px-1">
          Messages: ↑ {data.total_user_messages.toLocaleString()} user · ↓ {data.total_assistant_messages.toLocaleString()} assistant
        </section>
      </div>
    </main>
  );
}

