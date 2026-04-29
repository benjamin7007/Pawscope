import { useEffect, useState } from 'react';
import { useT } from '../i18n';

type Session = {
  id: string;
  agent: string;
  summary: string;
  status: string;
  repo?: string | null;
  last_event_at?: string | null;
};

type Pulse = { bins: number[]; events: number };

const DISMISS_KEY = 'pawscope.livepin.dismissed';
const COLLAPSE_KEY = 'pawscope.livepin.collapsed';

function elapsed(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return lang === 'zh' ? `${s}秒前` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return lang === 'zh' ? `${m}分前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === 'zh' ? `${h}小时前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === 'zh' ? `${d}天前` : `${d}d ago`;
}

function MiniSpark({ bins }: { bins: number[] }) {
  if (!bins || bins.length === 0) return null;
  const max = Math.max(1, ...bins);
  return (
    <div className="flex items-end gap-px h-5 w-20">
      {bins.slice(-20).map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-emerald-500/70 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
        />
      ))}
    </div>
  );
}

export function LivePin({
  sessions,
  pulseMap,
  onOpen,
}: {
  sessions: Session[];
  pulseMap: Record<string, Pulse>;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useT();
  const [, tick] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); }
    catch { return []; }
  });
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    localStorage.getItem(COLLAPSE_KEY) === '1'
  );

  // Re-render every 30s so "elapsed" labels stay fresh.
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  };

  const active = sessions.filter(
    s => s.status === 'active' && !dismissed.includes(s.id),
  );
  if (active.length === 0) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/90 border border-emerald-500/40 hover:border-emerald-400 shadow-lg backdrop-blur"
        title={t('livepin.expand')}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs text-slate-100 font-medium tabular-nums">{active.length}</span>
        <span className="text-[10px] text-slate-400">{t('livepin.live')}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg bg-slate-900/95 border border-emerald-500/30 shadow-xl backdrop-blur">
      <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-slate-100">
            {t('livepin.title')} <span className="text-slate-500">({active.length})</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="px-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 text-xs"
          title={t('livepin.collapse')}
        >−</button>
      </header>
      <ul className="max-h-72 overflow-auto divide-y divide-slate-800">
        {active.slice(0, 5).map(s => {
          const pulse = pulseMap[s.id];
          return (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-[11px] text-slate-100 truncate font-medium">
                    {s.summary || s.id.slice(0, 8)}
                  </span>
                  <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">
                    {elapsed(s.last_event_at, lang)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] text-slate-300 font-mono">
                      {s.agent}
                    </span>
                    {s.repo && (
                      <span className="text-[10px] text-slate-500 truncate">{s.repo}</span>
                    )}
                  </div>
                  {pulse && <MiniSpark bins={pulse.bins} />}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); dismiss(s.id); }}
                className="absolute top-1 right-1 hidden group-hover:block px-1 rounded text-slate-600 hover:text-slate-200 hover:bg-slate-800 text-[10px]"
                title={t('livepin.dismiss')}
              >×</button>
            </li>
          );
        })}
      </ul>
      {active.length > 5 && (
        <div className="px-3 py-1.5 text-[10px] text-slate-500 text-center border-t border-slate-800">
          +{active.length - 5} {t('livepin.more')}
        </div>
      )}
    </div>
  );
}
