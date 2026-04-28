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

type SortMode = 'recent' | 'oldest' | 'repo';

export function SessionList({ items, onSelect, selected }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const agents = useMemo(
    () => Array.from(new Set(items.map(s => s.agent))).sort(),
    [items]
  );

  const { active, byRepo, repoOrder, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(s => {
      if (agentFilter !== 'all' && s.agent !== agentFilter) return false;
      if (activeOnly && s.status !== 'active') return false;
      if (!q) return true;
      return (
        (s.id?.toLowerCase().includes(q)) ||
        (s.repo?.toLowerCase().includes(q)) ||
        (s.summary?.toLowerCase().includes(q)) ||
        (s.branch?.toLowerCase().includes(q))
      );
    });

    const cmp = (a: Session, b: Session) => {
      if (sortMode === 'repo') {
        return (a.repo ?? '').localeCompare(b.repo ?? '');
      }
      const ta = a.last_event_at ? new Date(a.last_event_at).getTime() : 0;
      const tb = b.last_event_at ? new Date(b.last_event_at).getTime() : 0;
      return sortMode === 'oldest' ? ta - tb : tb - ta;
    };
    const sorted = [...filtered].sort(cmp);

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
      if (sortMode === 'repo') return a.localeCompare(b);
      const la = byRepo.get(a)![0].last_event_at ?? '';
      const lb = byRepo.get(b)![0].last_event_at ?? '';
      return sortMode === 'oldest' ? la.localeCompare(lb) : lb.localeCompare(la);
    });

    return { active, byRepo, repoOrder, total: filtered.length };
  }, [items, query, agentFilter, activeOnly, sortMode]);

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
    <aside className="flex-1 flex flex-col min-h-0">
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
        <div className="flex items-center gap-1.5 mt-2">
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            title="Filter by agent"
            className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-slate-600"
          >
            <option value="all">All agents</option>
            {agents.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            title="Sort"
            className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-slate-600"
          >
            <option value="recent">Recent</option>
            <option value="oldest">Oldest</option>
            <option value="repo">Repo A→Z</option>
          </select>
          <button
            onClick={() => setActiveOnly(v => !v)}
            title="Show only active sessions"
            className={`px-2 py-1 text-[11px] rounded border transition-colors flex-shrink-0 ${
              activeOnly
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ● Live
          </button>
        </div>
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
