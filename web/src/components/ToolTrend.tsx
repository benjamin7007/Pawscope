import { useEffect, useMemo, useState } from 'react';
import { fetchToolsTrend, type ToolTrendResponse } from '../api';
import { useT } from '../i18n';

const COLORS = [
  '#22d3ee', '#34d399', '#a78bfa', '#fbbf24',
  '#fb7185', '#fb923c', '#60a5fa', '#f472b6',
];
const OTHER_COLOR = '#475569';

const RANGES: { key: '24h' | '7d' | '30d'; hours: number }[] = [
  { key: '24h', hours: 24 },
  { key: '7d', hours: 168 },
  { key: '30d', hours: 720 },
];

export function ToolTrend() {
  const { t } = useT();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [data, setData] = useState<ToolTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    const hours = RANGES.find((r) => r.key === range)?.hours ?? 168;
    fetchToolsTrend(hours, 6)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [range]);

  const view = useMemo(() => {
    if (!data) return null;
    const max = Math.max(1, ...data.totals);
    const colorMap = new Map<string, string>();
    data.series.forEach((s, i) => {
      colorMap.set(s.name, s.name === 'other' ? OTHER_COLOR : COLORS[i % COLORS.length]);
    });
    return { max, colorMap };
  }, [data]);

  const startTs = data ? new Date(data.window_start).getTime() : 0;
  const endTs = data ? new Date(data.now).getTime() : 0;

  const W = 720;
  const H = 160;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 8;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const totalAll = data?.totals.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 flex-1">
          {t('sec.tool_trend')}
        </h3>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {totalAll.toLocaleString()} calls
        </span>
        <div className="flex gap-0.5 bg-slate-950/60 rounded p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded transition-colors ${
                range === r.key
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(`tool_trend.range.${r.key}` as any)}
            </button>
          ))}
        </div>
      </header>
      <div className="p-4">
        {loading && !data ? (
          <div className="h-40 flex items-center justify-center text-xs text-slate-500">…</div>
        ) : !data || data.series.length === 0 || totalAll === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-slate-600">
            {t('tool_trend.empty')}
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-44"
              onMouseLeave={() => setHover(null)}
            >
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f}
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={PAD_T + innerH * (1 - f)}
                  y2={PAD_T + innerH * (1 - f)}
                  stroke="#1e293b"
                  strokeWidth="0.5"
                />
              ))}
              <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize="9" fill="#64748b">
                {view!.max}
              </text>
              <text x={PAD_L - 4} y={PAD_T + innerH + 3} textAnchor="end" fontSize="9" fill="#64748b">
                0
              </text>

              {data.totals.map((_, i) => {
                const barW = innerW / data.totals.length;
                const x = PAD_L + i * barW;
                let yCursor = PAD_T + innerH;
                return (
                  <g
                    key={i}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({
                        idx: i,
                        x: ((x + barW / 2) / W) * rect.width,
                        y: ((PAD_T + innerH - innerH * (data.totals[i] / view!.max)) / H) * rect.height,
                      });
                    }}
                  >
                    <rect
                      x={x}
                      y={PAD_T}
                      width={barW}
                      height={innerH}
                      fill="transparent"
                    />
                    {data.series.map((s) => {
                      const v = s.counts[i];
                      if (v === 0) return null;
                      const h = innerH * (v / view!.max);
                      yCursor -= h;
                      return (
                        <rect
                          key={s.name}
                          x={x + 0.5}
                          y={yCursor}
                          width={Math.max(barW - 1, 0.5)}
                          height={h}
                          fill={view!.colorMap.get(s.name)}
                          opacity={hover && hover.idx !== i ? 0.4 : 0.95}
                        />
                      );
                    })}
                  </g>
                );
              })}

              <text
                x={PAD_L}
                y={H - 6}
                fontSize="9"
                fill="#64748b"
              >
                {new Date(startTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })}
              </text>
              <text
                x={W - PAD_R}
                y={H - 6}
                fontSize="9"
                fill="#64748b"
                textAnchor="end"
              >
                {new Date(endTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })}
              </text>
            </svg>

            {hover && data.totals[hover.idx] > 0 && (() => {
              const bucketHourSpan = data.hours / data.totals.length;
              const bucketEnd = new Date(endTs - (data.totals.length - 1 - hover.idx) * 3600_000);
              return (
                <div className="mt-1 text-[11px] text-slate-300">
                  <span className="font-mono text-slate-100">
                    {bucketEnd.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })}
                  </span>
                  <span className="text-slate-500"> · {bucketHourSpan}h bucket · </span>
                  <span className="font-mono">{data.totals[hover.idx]}</span>
                  <span className="text-slate-500"> calls</span>
                </div>
              );
            })()}

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
              {data.series.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span
                    className="w-2 h-2 rounded-sm"
                    style={{ background: view!.colorMap.get(s.name) }}
                  />
                  <span className="font-mono">{s.name}</span>
                  <span className="text-slate-500 tabular-nums">{s.total}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
