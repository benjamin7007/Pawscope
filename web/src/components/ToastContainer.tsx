import { useEffect, useState } from 'react';
import { subscribeToast, type ToastPayload } from '../toast';

const STYLE: Record<ToastPayload['kind'], { ring: string; icon: string; iconColor: string }> = {
  success: { ring: 'border-emerald-500/40 bg-emerald-950/80', icon: '✓', iconColor: 'text-emerald-400' },
  error:   { ring: 'border-rose-500/40 bg-rose-950/80',       icon: '✕', iconColor: 'text-rose-400' },
  info:    { ring: 'border-cyan-500/40 bg-cyan-950/80',       icon: 'ℹ', iconColor: 'text-cyan-400' },
};

export function ToastContainer() {
  const [items, setItems] = useState<ToastPayload[]>([]);

  useEffect(() => {
    return subscribeToast((t) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, t.ttl);
    });
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div
            key={t.id}
            className={`pawscope-toast pointer-events-auto min-w-[240px] max-w-[420px] flex items-start gap-2 px-3 py-2 rounded-md border ${s.ring} backdrop-blur-sm shadow-lg`}
          >
            <span className={`text-sm leading-5 ${s.iconColor}`}>{s.icon}</span>
            <span className="flex-1 text-[13px] leading-5 text-slate-100 whitespace-pre-wrap break-words">
              {t.message}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-500 hover:text-slate-300 text-xs leading-5"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
