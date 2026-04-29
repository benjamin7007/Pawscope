import { useEffect, useState } from 'react';
import { fetchOverview, fetchActivity, fetchActivityGrid } from '../api';

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
};

function HeroStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-5 py-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function BarList({ entries, max, color }: { entries: [string, number][]; max: number; color: string }) {
  if (entries.length === 0) {
    return <div className="text-xs text-slate-600 text-center py-4">None.</div>;
  }
  return (
    <ul className="divide-y divide-slate-800/60">
      {entries.map(([k, v]) => (
        <li key={k} className="px-4 py-2 flex items-center gap-3 text-sm">
          <span className="font-mono text-slate-200 w-40 truncate">{k}</span>
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} />
          </div>
          <span className="text-slate-400 tabular-nums w-14 text-right">×{v}</span>
        </li>
      ))}
    </ul>
  );
}

function WeekGrid({ grid }: { grid: number[][] }) {
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
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yest';
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  };

  // grid[0] = today, render today at the bottom for natural reading
  const rows = grid.map((row, i) => ({ daysAgo: i, row })).reverse();

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">7 days × 24h activity</h3>
        <span className="text-[11px] text-slate-500">{total.toLocaleString()} events</span>
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
                    title={`${dayLabel(daysAgo)} ${String(h).padStart(2, '0')}:00 · ${v} events`}
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
          <span>less</span>
          {['bg-slate-800/60', 'bg-emerald-900/70', 'bg-emerald-800', 'bg-emerald-600', 'bg-emerald-500', 'bg-emerald-400'].map(c => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span>more</span>
        </div>
      </div>
    </section>
  );
}

function ActivityHeatmap({ buckets }: { buckets: number[] }) {
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
        <h3 className="text-xs uppercase tracking-wider text-slate-400">24h activity</h3>
        <span className="text-[11px] text-slate-500">{total.toLocaleString()} events</span>
      </header>
      <div className="p-4">
        <div className="grid grid-cols-24 gap-1" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0,1fr))` }}>
          {buckets.map((v, i) => {
            const hour = (startHour + i) % 24;
            const hoursAgo = buckets.length - 1 - i;
            const label = `${hoursAgo === 0 ? 'now' : `${hoursAgo}h ago`} · ${String(hour).padStart(2, '0')}:00 · ${v} events`;
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

export function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<number[] | null>(null);
  const [grid, setGrid] = useState<number[][] | null>(null);
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
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;
  if (!data) return <main className="flex-1 p-8 text-slate-500 text-sm">Aggregating across all sessions…</main>;

  const tools = Object.entries(data.tools_used).sort((a, b) => b[1] - a[1]);
  const skills = Object.entries(data.skills_invoked).sort((a, b) => b[1] - a[1]);
  const repos = Object.entries(data.by_repo).sort((a, b) => b[1] - a[1]);
  const agents = Object.entries(data.by_agent).sort((a, b) => b[1] - a[1]);
  const toolsMax = tools[0]?.[1] ?? 0;
  const skillsMax = skills[0]?.[1] ?? 0;
  const reposMax = repos[0]?.[1] ?? 0;
  const totalTools = tools.reduce((a, [, v]) => a + v, 0);

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-6 pb-5 border-b border-slate-800 bg-slate-900/30">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Overview</div>
        <h1 className="text-2xl font-semibold text-slate-100">All sessions</h1>
        <p className="text-xs text-slate-500 mt-1">Aggregated across every detected session. Refreshes every 15s.</p>
      </header>

      <div className="p-6 space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Sessions" value={data.total_sessions} />
          <HeroStat
            label="Active"
            value={data.active_sessions}
            accent={data.active_sessions > 0 ? 'text-emerald-300' : 'text-slate-100'}
          />
          <HeroStat label="Turns" value={data.total_turns.toLocaleString()} />
          <HeroStat label="Tool calls" value={totalTools.toLocaleString()} />
        </section>

        {activity && <ActivityHeatmap buckets={activity} />}
        {grid && <WeekGrid grid={grid} />}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Top tools</h3>
              <span className="text-[11px] text-slate-500">{tools.length} unique</span>
            </header>
            <BarList entries={tools.slice(0, 12)} max={toolsMax} color="bg-gradient-to-r from-emerald-500/70 to-emerald-400" />
          </div>
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Top skills</h3>
              <span className="text-[11px] text-slate-500">{skills.length} unique</span>
            </header>
            <BarList entries={skills.slice(0, 12)} max={skillsMax} color="bg-gradient-to-r from-sky-500/70 to-sky-400" />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Top repos</h3>
            </header>
            <BarList entries={repos.slice(0, 10)} max={reposMax} color="bg-gradient-to-r from-violet-500/70 to-violet-400" />
          </div>
          <div className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Agents</h3>
            </header>
            <div className="p-4 flex flex-wrap gap-2">
              {agents.map(([k, v]) => (
                <span key={k} className="px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200">
                  {k} <span className="text-slate-500 ml-1">×{v}</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="text-[11px] text-slate-600 px-1">
          Messages: ↑ {data.total_user_messages.toLocaleString()} user · ↓ {data.total_assistant_messages.toLocaleString()} assistant
        </section>
      </div>
    </main>
  );
}
