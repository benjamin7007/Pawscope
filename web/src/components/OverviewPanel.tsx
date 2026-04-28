import { useEffect, useState } from 'react';
import { fetchOverview } from '../api';

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

export function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchOverview()
        .then(d => !cancelled && setData(d))
        .catch(e => !cancelled && setErr(String(e)));
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
