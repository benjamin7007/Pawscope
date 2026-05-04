export const CATEGORY_PALETTE = [
  '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#facc15',
  '#fb923c', '#22d3ee', '#f87171', '#4ade80', '#c084fc',
  '#fbbf24', '#38bdf8', '#e879f9', '#94a3b8', '#fda4af',
  '#86efac', '#93c5fd', '#fcd34d', '#fdba74', '#a3e635',
];

export type CategoryStat = { name: string; invocations: number; count: number; used: number };

export function CategoryDonut({
  stats,
  total,
  lang,
  fmt,
  onPick,
  compact = false,
  selected,
  getLabel,
  bare = false,
}: {
  stats: CategoryStat[];
  total: number;
  lang: string;
  fmt: (n: number) => string;
  onPick?: (name: string) => void;
  compact?: boolean;
  selected?: string | null;
  getLabel?: (name: string) => string;
  bare?: boolean;
}) {
  const R = compact ? 36 : 56;
  const W = compact ? 11 : 18;
  const SIZE = compact ? 100 : 160;
  const VB = compact ? 50 : 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const slices = stats.map((s, i) => {
    const frac = total > 0 ? s.invocations / total : 0;
    const seg = frac * C;
    const slice = {
      ...s,
      color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
      dasharray: `${seg} ${C - seg}`,
      dashoffset: -offset,
      pct: frac * 100,
    };
    offset += seg;
    return slice;
  });
  const totalFontSize = compact ? 11 : 16;
  const labelFontSize = compact ? 7 : 9;
  const body = (
    <div className={`px-4 ${compact ? 'py-3' : 'py-4'} flex items-center gap-6 flex-wrap`}>
        <svg
          viewBox={`-${VB} -${VB} ${VB * 2} ${VB * 2}`}
          width={SIZE}
          height={SIZE}
          className="flex-shrink-0"
        >
          <circle r={R} fill="none" stroke="#1e293b" strokeWidth={W} />
          {slices.map(s => {
            const isSel = selected && s.name === selected;
            return (
              <circle
                key={s.name}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={isSel ? W + 2 : W}
                strokeDasharray={s.dasharray}
                strokeDashoffset={s.dashoffset}
                transform="rotate(-90)"
                opacity={selected && !isSel ? 0.35 : 1}
                style={onPick ? { cursor: 'pointer', transition: 'stroke-width 120ms, opacity 120ms' } : undefined}
                onClick={onPick ? () => onPick(s.name) : undefined}
              >
                <title>{`${getLabel ? getLabel(s.name) : s.name}: ${fmt(s.invocations)} (${s.pct.toFixed(1)}%)`}</title>
              </circle>
            );
          })}
          <text
            textAnchor="middle"
            y={compact ? -1 : -2}
            className="fill-slate-100"
            style={{ fontSize: totalFontSize, fontWeight: 600 }}
          >
            {fmt(total)}
          </text>
          <text
            textAnchor="middle"
            y={compact ? 9 : 14}
            className="fill-slate-500"
            style={{ fontSize: labelFontSize }}
          >
            {lang === 'zh' ? '总调用' : 'invocations'}
          </text>
        </svg>
        <ul
          className={`flex-1 min-w-[260px] grid gap-x-4 gap-y-1 text-[12px] ${
            compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          {slices.map(s => {
            const isSel = selected && s.name === selected;
            const row = (
              <>
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span
                  className={`truncate ${isSel ? 'text-slate-100 font-semibold' : 'text-slate-200'}`}
                  title={s.name}
                >
                  {getLabel ? getLabel(s.name) : s.name}
                </span>
                <span className="ml-auto tabular-nums text-slate-400 flex-shrink-0">
                  {fmt(s.invocations)}
                </span>
                <span className="tabular-nums text-slate-600 flex-shrink-0 w-12 text-right">
                  {s.pct.toFixed(1)}%
                </span>
              </>
            );
            return (
              <li key={s.name}>
                {onPick ? (
                  <button
                    type="button"
                    onClick={() => onPick(s.name)}
                    className={`w-full flex items-baseline gap-2 min-w-0 text-left rounded px-1 -mx-1 py-0.5 cursor-pointer ${
                      isSel ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex items-baseline gap-2 min-w-0">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );

  if (bare) return body;

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">
          {lang === 'zh' ? '各分类调用量占比' : 'Invocations by category'}
        </h3>
        <span className="text-[11px] text-slate-500">
          {fmt(total)} {lang === 'zh' ? '次' : 'invocations'} · {stats.length}{' '}
          {lang === 'zh' ? '类' : 'categories'}
        </span>
      </header>
      {body}
    </section>
  );
}
