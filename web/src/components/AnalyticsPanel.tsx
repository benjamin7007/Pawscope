import { useEffect, useState } from 'react';
import { fetchAnalytics, type AnalyticsData } from '../api';
import { useT } from '../i18n';

function fmtDuration(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function AnalyticsSkeleton() {
  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 animate-pulse">
          <div className="h-4 w-32 bg-slate-800 rounded mb-3" />
          <div className="h-20 bg-slate-800/60 rounded" />
        </div>
      ))}
    </main>
  );
}

export function AnalyticsPanel() {
  const { t, fmt } = useT();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [agentFilter, setAgentFilter] = useState<string | undefined>(undefined);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchAnalytics(days, agentFilter)
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [days, agentFilter]);

  if (loading) return <AnalyticsSkeleton />;
  if (error) return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-300 text-sm">{error}</div>
    </main>
  );
  if (!data) return null;

  const totalTokens = data.tokens_by_agent.reduce((s, a) => s + a.tokens_in + a.tokens_out, 0);
  const engagedPct = data.completed_sessions > 0
    ? Math.round((data.engaged_sessions / data.completed_sessions) * 100)
    : 0;

  const maxDaily = Math.max(...data.daily.map(d => d.count), 1);

  const allAgents = data.agent_stats.map(a => a.agent);
  const mostUsedAgent = data.agent_stats.reduce(
    (best, a) => (a.sessions > (best?.sessions ?? 0) ? a : best),
    data.agent_stats[0],
  );

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Kicker */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          {t('analytics.kicker')}
        </span>
        <h2 className="text-lg font-bold text-slate-100 mt-0.5">{t('analytics.title')}</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-400 mr-1">{t('analytics.filter_days')}:</span>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              days === d
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            {d}d
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-3 mr-1">{t('analytics.filter_agent')}:</span>
        <button
          onClick={() => setAgentFilter(undefined)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            !agentFilter
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
          }`}
        >
          {t('analytics.filter_all')}
        </button>
        {allAgents.map(a => (
          <button
            key={a}
            onClick={() => setAgentFilter(a)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
              agentFilter === a
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Card 1: KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('analytics.kpi_sessions'), value: fmt(data.total_sessions) },
          { label: t('analytics.kpi_duration'), value: fmtDuration(data.avg_duration_mins) },
          { label: t('analytics.kpi_engaged'), value: `${engagedPct}%` },
          { label: t('analytics.kpi_tokens'), value: fmtTokens(totalTokens) },
        ].map(kpi => (
          <div key={kpi.label} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-slate-100">{kpi.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Card 2: Duration Distribution */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('analytics.duration_dist')}</h3>
        <div className="space-y-2">
          {data.duration_buckets.map(b => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400 w-14 text-right flex-shrink-0">{b.label}</span>
              <div className="flex-1 h-5 bg-slate-800/60 rounded overflow-hidden">
                <div
                  className="h-full rounded bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
                  style={{ width: `${Math.max(b.pct, 0.5)}%` }}
                />
              </div>
              <span className="text-[11px] text-slate-500 w-10 text-right">{b.count}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-[10px] text-slate-500">
          <span>Median: {fmtDuration(data.median_duration_mins)}</span>
          <span>P90: {fmtDuration(data.p90_duration_mins)}</span>
          <span>Completed: {data.completed_sessions}</span>
        </div>
      </div>

      {/* Card 3: Daily Trend */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('analytics.daily_trend')}</h3>
        {data.daily.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center">No data</div>
        ) : (
          <div className="flex items-end gap-px h-32">
            {data.daily.map((d, i) => {
              const h = Math.max((d.count / maxDaily) * 100, 2);
              const showLabel = i === 0 || i === data.daily.length - 1 || i % 5 === 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full rounded-t bg-emerald-400 hover:bg-emerald-300 transition-colors min-w-[3px]"
                    style={{ height: `${h}%` }}
                    title={`${d.date}: ${d.count} sessions`}
                  />
                  {showLabel && (
                    <span className="text-[8px] text-slate-600 mt-1 whitespace-nowrap">
                      {d.date.slice(5)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Card 4: Agent Comparison */}
      {data.agent_stats.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('analytics.agent_comparison')}</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-3 font-medium">{t('analytics.col_agent')}</th>
                <th className="text-right py-1.5 px-2 font-medium">{t('analytics.col_sessions')}</th>
                <th className="text-right py-1.5 px-2 font-medium">{t('analytics.col_avg_turns')}</th>
                <th className="text-right py-1.5 px-2 font-medium">{t('analytics.col_avg_duration')}</th>
                <th className="text-right py-1.5 px-2 font-medium">{t('analytics.col_avg_tokens_in')}</th>
                <th className="text-right py-1.5 pl-2 font-medium">{t('analytics.col_avg_tokens_out')}</th>
              </tr>
            </thead>
            <tbody>
              {data.agent_stats.map(a => (
                <tr
                  key={a.agent}
                  className={`border-b border-slate-800/50 ${
                    mostUsedAgent && a.agent === mostUsedAgent.agent ? 'bg-emerald-500/5' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3 text-slate-200 capitalize">{a.agent}</td>
                  <td className="text-right py-1.5 px-2 text-slate-300">{a.sessions}</td>
                  <td className="text-right py-1.5 px-2 text-slate-400">{a.avg_turns.toFixed(1)}</td>
                  <td className="text-right py-1.5 px-2 text-slate-400">{fmtDuration(a.avg_duration_mins)}</td>
                  <td className="text-right py-1.5 px-2 text-slate-400">{fmtTokens(a.avg_tokens_in)}</td>
                  <td className="text-right py-1.5 pl-2 text-slate-400">{fmtTokens(a.avg_tokens_out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Card 5: Tool Heatmap */}
      {data.tool_heatmap.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('analytics.tool_heatmap')}</h3>
          <div className="min-w-[600px]">
            {/* Hour labels */}
            <div className="flex ml-28">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="flex-1 text-center text-[8px] text-slate-600">
                  {i % 6 === 0 ? i : ''}
                </div>
              ))}
            </div>
            {data.tool_heatmap.map(row => {
              const maxVal = Math.max(...row.hours, 1);
              return (
                <div key={row.tool} className="flex items-center mb-px">
                  <span className="w-28 text-[10px] text-slate-400 truncate pr-2 text-right flex-shrink-0">
                    {row.tool}
                  </span>
                  <div className="flex flex-1">
                    {row.hours.map((v, h) => {
                      const intensity = v / maxVal;
                      let bg = 'transparent';
                      if (v > 0) {
                        if (intensity > 0.75) bg = 'rgb(52 211 153)';       // emerald-400
                        else if (intensity > 0.5) bg = 'rgb(16 185 129)';   // emerald-500
                        else if (intensity > 0.25) bg = 'rgb(6 95 70)';     // emerald-800
                        else bg = 'rgb(6 78 59)';                            // emerald-900
                      }
                      return (
                        <div
                          key={h}
                          className="flex-1 h-4 border border-slate-900/30"
                          style={{ backgroundColor: bg }}
                          title={`${row.tool} @ ${h}:00 — ${v} calls`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Card 6: Token Breakdown */}
      {data.tokens_by_agent.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('analytics.token_breakdown')}</h3>
          <div className="space-y-2">
            {data.tokens_by_agent.map(a => {
              const total = a.tokens_in + a.tokens_out;
              const maxTotal = Math.max(
                ...data.tokens_by_agent.map(x => x.tokens_in + x.tokens_out),
                1,
              );
              const widthPct = (total / maxTotal) * 100;
              const inPct = total > 0 ? (a.tokens_in / total) * 100 : 50;
              return (
                <div key={a.agent}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-slate-300 capitalize">{a.agent}</span>
                    <span className="text-slate-500">{fmtTokens(total)}</span>
                  </div>
                  <div className="h-4 bg-slate-800/60 rounded overflow-hidden" style={{ width: `${Math.max(widthPct, 3)}%` }}>
                    <div className="flex h-full">
                      <div
                        className="bg-blue-500 h-full"
                        style={{ width: `${inPct}%` }}
                        title={`In: ${fmtTokens(a.tokens_in)}`}
                      />
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${100 - inPct}%` }}
                        title={`Out: ${fmtTokens(a.tokens_out)}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-4 text-[10px] text-slate-500 mt-2">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500 inline-block" /> In</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500 inline-block" /> Out</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
