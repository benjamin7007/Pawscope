import { useMemo, useState } from 'react';

type Session = {
  id: string;
  agent: string;
  repo?: string | null;
  branch?: string | null;
  summary?: string | null;
  status: string;
  last_event_at?: string | null;
};

type Props = {
  items: Session[];
  onSelect: (id: string) => void;
  selected: string | null;
};

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function repoLabel(s: Session): string {
  return s.repo || '(no repo)';
}

export function SessionList({ items, onSelect, selected }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { active, byRepo, repoOrder, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter(s =>
          (s.id?.toLowerCase().includes(q)) ||
          (s.repo?.toLowerCase().includes(q)) ||
          (s.summary?.toLowerCase().includes(q)) ||
          (s.branch?.toLowerCase().includes(q))
        )
      : items;

    const sorted = [...filtered].sort((a, b) => {
      const ta = a.last_event_at ? new Date(a.last_event_at).getTime() : 0;
      const tb = b.last_event_at ? new Date(b.last_event_at).getTime() : 0;
      return tb - ta;
    });

    const active = sorted.filter(s => s.status === 'active');
    const inactive = sorted.filter(s => s.status !== 'active');

    const byRepo = new Map<string, Session[]>();
    for (const s of inactive) {
      const k = repoLabel(s);
      const arr = byRepo.get(k) ?? [];
      arr.push(s);
      byRepo.set(k, arr);
    }
    const repoOrder = Array.from(byRepo.keys()).sort((a, b) => {
      const la = byRepo.get(a)![0].last_event_at ?? '';
      const lb = byRepo.get(b)![0].last_event_at ?? '';
      return lb.localeCompare(la);
    });

    return { active, byRepo, repoOrder, total: filtered.length };
  }, [items, query]);

  const toggle = (key: string) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const renderRow = (s: Session) => (
    <button
      key={s.id}
      onClick={() => onSelect(s.id)}
      className={`group block w-full text-left px-3 py-2 border-l-2 transition-colors ${
        selected === s.id
          ? 'bg-slate-800/80 border-emerald-400'
          : 'border-transparent hover:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            s.status === 'active' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600'
          }`}
        />
        <span className="font-mono text-[10px] text-slate-500">{s.id.slice(0, 8)}</span>
        <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(s.last_event_at)}</span>
      </div>
      <div className="text-sm mt-0.5 truncate text-slate-200">
        {s.summary || <span className="text-slate-500 italic">(no summary)</span>}
      </div>
      {s.branch && (
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          <span className="text-slate-600">⎇</span> {s.branch}
        </div>
      )}
    </button>
  );

  const renderGroup = (key: string, label: string, list: Session[], accent?: string) => {
    if (list.length === 0) return null;
    const isCollapsed = collapsed[key];
    return (
      <div key={key} className="mb-1">
        <button
          onClick={() => toggle(key)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
        >
          <span className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
          {accent && <span className={accent}>●</span>}
          <span className="font-semibold truncate">{label}</span>
          <span className="ml-auto text-slate-600">{list.length}</span>
        </button>
        {!isCollapsed && <div>{list.map(renderRow)}</div>}
      </div>
    );
  };

  return (
    <aside className="w-80 border-r border-slate-800 flex flex-col bg-slate-950/50">
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-200">Sessions</h2>
          <span className="text-[10px] text-slate-500">{total} total</span>
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search id, repo, summary…"
          className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {renderGroup('active', 'Active', active, 'text-emerald-400')}
        {repoOrder.map(repo =>
          renderGroup(`repo:${repo}`, repo, byRepo.get(repo)!)
        )}
        {total === 0 && (
          <div className="text-xs text-slate-600 text-center py-8">No sessions match.</div>
        )}
      </div>
    </aside>
  );
}
