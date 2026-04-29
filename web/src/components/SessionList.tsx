import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { estimateCostUsd, formatUsd } from '../pricing';

type Session = {
  id: string;
  agent: string;
  cwd?: string | null;
  repo?: string | null;
  branch?: string | null;
  summary?: string | null;
  model?: string | null;
  status: string;
  last_event_at?: string | null;
};

type Props = {
  items: Session[];
  onSelect: (id: string) => void;
  selected: string | null;
  realmFilter?: string | null;
  onClearRealmFilter?: () => void;
  labels?: Record<string, { starred: boolean; tags: string[]; note?: string | null }>;
  onToggleStar?: (id: string) => void;
  tokensMap?: Record<string, { in: number; out: number }>;
  pulseMap?: Record<string, { bins: number[]; events: number }>;
  compareIds?: string[];
  onToggleCompare?: (id: string) => void;
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

function sessionRealmKey(s: Session): string {
  if (s.repo) return s.repo;
  const cwd = s.cwd ?? '';
  const parts = cwd.split('/').filter(Boolean);
  return parts.length ? `~/${parts[parts.length - 1]}` : cwd;
}

type SortMode = 'recent' | 'oldest' | 'repo' | 'tokens';

export function SessionList({ items, onSelect, selected, realmFilter, onClearRealmFilter, labels, onToggleStar, tokensMap, pulseMap, compareIds, onToggleCompare }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    Object.values(labels ?? {}).forEach((l) => l.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [labels]);

  const agents = useMemo(
    () => Array.from(new Set(items.map(s => s.agent))).sort(),
    [items]
  );

  const { starred, active, byRepo, repoOrder, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(s => {
      if (realmFilter && sessionRealmKey(s) !== realmFilter) return false;
      if (agentFilter !== 'all' && s.agent !== agentFilter) return false;
      if (activeOnly && s.status !== 'active') return false;
      const lbl = labels?.[s.id];
      if (starredOnly && !lbl?.starred) return false;
      if (tagFilter !== 'all' && !lbl?.tags?.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        (s.id?.toLowerCase().includes(q)) ||
        (s.repo?.toLowerCase().includes(q)) ||
        (s.summary?.toLowerCase().includes(q)) ||
        (s.branch?.toLowerCase().includes(q)) ||
        (lbl?.note?.toLowerCase().includes(q) ?? false)
      );
    });

    const cmp = (a: Session, b: Session) => {
      if (sortMode === 'repo') {
        return (a.repo ?? '').localeCompare(b.repo ?? '');
      }
      if (sortMode === 'tokens') {
        const ta = (tokensMap?.[a.id]?.in ?? 0) + (tokensMap?.[a.id]?.out ?? 0);
        const tb = (tokensMap?.[b.id]?.in ?? 0) + (tokensMap?.[b.id]?.out ?? 0);
        return tb - ta;
      }
      const ta = a.last_event_at ? new Date(a.last_event_at).getTime() : 0;
      const tb = b.last_event_at ? new Date(b.last_event_at).getTime() : 0;
      return sortMode === 'oldest' ? ta - tb : tb - ta;
    };
    const sorted = [...filtered].sort(cmp);

    // When the Live filter is on, do NOT pull starred sessions into a separate
    // group — otherwise starred-active sessions become invisible (they would
    // sit in the Starred bucket while the Active bucket is empty).
    const starred = activeOnly ? [] : sorted.filter(s => labels?.[s.id]?.starred);
    const starredIds = new Set(starred.map(s => s.id));
    const rest = sorted.filter(s => !starredIds.has(s.id));

    const active = rest.filter(s => s.status === 'active');
    const inactive = rest.filter(s => s.status !== 'active');

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

    return { starred, active, byRepo, repoOrder, total: filtered.length };
  }, [items, query, agentFilter, activeOnly, sortMode, realmFilter, starredOnly, tagFilter, labels, tokensMap]);

  const toggle = (key: string) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const renderRow = (s: Session) => {
    const lbl = labels?.[s.id];
    const tk = tokensMap?.[s.id];
    const tkTotal = tk ? tk.in + tk.out : 0;
    const cost = tk ? estimateCostUsd(s.model, tk.in, tk.out) : null;
    const fmtK = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`;
    const pulse = pulseMap?.[s.id];
    const inCompare = !!compareIds?.includes(s.id);
    return (
    <button
      key={s.id}
      onClick={(e) => {
        // Shift-click toggles compare set (no navigation).
        if (e.shiftKey && onToggleCompare) {
          e.preventDefault();
          onToggleCompare(s.id);
          return;
        }
        onSelect(s.id);
      }}
      title={onToggleCompare ? 'Click to open · Shift+click to add to compare' : undefined}
      className={`group block w-full text-left px-3 py-2 border-l-2 transition-colors ${
        selected === s.id
          ? 'bg-slate-800/80 border-emerald-400'
          : inCompare
            ? 'bg-emerald-500/5 border-emerald-500/40'
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
        {onToggleCompare && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onToggleCompare(s.id); }}
            className={`cursor-pointer text-[11px] leading-none ${inCompare ? 'text-emerald-300' : 'text-slate-700 hover:text-slate-400'}`}
            title={inCompare ? 'Remove from compare' : 'Add to compare'}
          >
            {inCompare ? '☑' : '☐'}
          </span>
        )}
        {onToggleStar && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onToggleStar(s.id); }}
            className={`cursor-pointer text-xs leading-none ${lbl?.starred ? 'text-amber-300' : 'text-slate-700 hover:text-slate-400'}`}
            title={lbl?.starred ? 'Unstar' : 'Star'}
          >
            {lbl?.starred ? '★' : '☆'}
          </span>
        )}
        <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(s.last_event_at)}</span>
      </div>
      <div className="text-sm mt-0.5 truncate text-slate-200">
        {s.summary || <span className="text-slate-500 italic">(no summary)</span>}
      </div>
      {lbl?.note && (
        <div className="text-[11px] mt-0.5 truncate text-amber-300/80 italic" title={lbl.note}>
          📝 {lbl.note}
        </div>
      )}
      {(s.branch || (lbl?.tags?.length ?? 0) > 0 || tkTotal > 0 || pulse) && (
        <div className="text-[11px] text-slate-500 mt-0.5 truncate flex items-center gap-1.5">
          {s.branch && <><span className="text-slate-600">⎇</span><span>{s.branch}</span></>}
          {lbl?.tags?.map((t) => (
            <span key={t} className="px-1 rounded bg-violet-500/10 text-violet-300 text-[10px]">#{t}</span>
          ))}
          {pulse && pulse.bins.length > 0 && (() => {
            const max = Math.max(1, ...pulse.bins);
            return (
              <div className="flex items-stretch gap-px h-2 ml-auto" title={`pulse · ${pulse.events} events`}>
                {pulse.bins.map((c, i) => (
                  <div
                    key={i}
                    className="w-0.5 rounded-sm"
                    style={{ background: c === 0 ? 'rgba(30,41,59,0.6)' : `rgba(34,211,238,${0.25 + (c/max) * 0.7})` }}
                  />
                ))}
              </div>
            );
          })()}
          {tkTotal > 0 && (
            <span
              className={`${pulse ? '' : 'ml-auto'} px-1.5 rounded bg-emerald-500/10 text-emerald-300 text-[10px] tabular-nums`}
              title={`in ${tk!.in.toLocaleString()} · out ${tk!.out.toLocaleString()}`}
            >
              ⚡ {fmtK(tkTotal)}
            </span>
          )}
          {cost !== null && (
            <span
              className="px-1.5 rounded bg-amber-500/10 text-amber-300 text-[10px] tabular-nums"
              title={`Estimated cost (${s.model})`}
            >
              {formatUsd(cost)}
            </span>
          )}
        </div>
      )}
    </button>
    );
  };

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

  // Flat virtualized list — built from same active/byRepo/repoOrder data.
  type FlatItem =
    | { type: 'header'; key: string; label: string; count: number; accent?: string; collapsed: boolean }
    | { type: 'row'; session: Session };

  const flat: FlatItem[] = [];
  if (starred.length > 0) {
    flat.push({
      type: 'header', key: 'starred', label: '★ Starred', count: starred.length,
      accent: 'text-amber-300', collapsed: !!collapsed['starred'],
    });
    if (!collapsed['starred']) {
      for (const s of starred) flat.push({ type: 'row', session: s });
    }
  }
  if (active.length > 0) {
    flat.push({
      type: 'header', key: 'active', label: 'Active', count: active.length,
      accent: 'text-emerald-400', collapsed: !!collapsed['active'],
    });
    if (!collapsed['active']) {
      for (const s of active) flat.push({ type: 'row', session: s });
    }
  }
  for (const repo of repoOrder) {
    const list = byRepo.get(repo)!;
    const k = `repo:${repo}`;
    flat.push({ type: 'header', key: k, label: repo, count: list.length, collapsed: !!collapsed[k] });
    if (!collapsed[k]) {
      for (const s of list) flat.push({ type: 'row', session: s });
    }
  }

  const ROW_BASE = 52;
  const ROW_META = 68;
  const ROW_NOTE_BUMP = 16;
  const HEADER_H = 30;
  const itemHeight = (it: FlatItem): number => {
    if (it.type === 'header') return HEADER_H;
    const lbl = labels?.[it.session.id];
    const hasMeta = !!it.session.branch || (lbl?.tags?.length ?? 0) > 0;
    let h = hasMeta ? ROW_META : ROW_BASE;
    if (lbl?.note) h += ROW_NOTE_BUMP;
    return h;
  };

  // Build cumulative offset table once per render.
  const offsets = useMemo(() => {
    const arr: number[] = new Array(flat.length + 1);
    arr[0] = 0;
    for (let i = 0; i < flat.length; i++) arr[i + 1] = arr[i] + itemHeight(flat[i]);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, labels]);
  const totalHeight = offsets[flat.length] ?? 0;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const VIRTUAL_THRESHOLD = 80;
  const useVirtual = flat.length > VIRTUAL_THRESHOLD;

  let firstIdx = 0;
  let lastIdx = flat.length;
  if (useVirtual && viewportH > 0) {
    const overscan = 6;
    // Linear scan — for ~1000 items this is fine; binary search is overkill.
    while (firstIdx < flat.length && offsets[firstIdx + 1] < scrollTop) firstIdx++;
    lastIdx = firstIdx;
    while (lastIdx < flat.length && offsets[lastIdx] < scrollTop + viewportH) lastIdx++;
    firstIdx = Math.max(0, firstIdx - overscan);
    lastIdx = Math.min(flat.length, lastIdx + overscan);
  }

  const visible = useVirtual ? flat.slice(firstIdx, lastIdx) : flat;
  const offsetTop = useVirtual ? offsets[firstIdx] : 0;

  return (
    <aside className="flex-1 flex flex-col min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-200">{t('list.title')}</h2>
          <span className="text-[10px] text-slate-500">{total} total</span>
        </div>
        {realmFilter && (
          <div className="mb-2 flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
            <span className="text-[10px] uppercase tracking-wider text-amber-300">{t('list.realm')}</span>
            <span className="font-mono text-[11px] text-amber-100 truncate flex-1" title={realmFilter}>
              {realmFilter}
            </span>
            <button
              onClick={onClearRealmFilter}
              className="text-amber-300 hover:text-amber-100 text-xs leading-none px-1"
              title="Clear realm filter"
            >
              ×
            </button>
          </div>
        )}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('list.search_ph')}
          className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        <div className="flex items-center gap-1.5 mt-2">
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            title="Filter by agent"
            className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-slate-600"
          >
            <option value="all">{t('list.all_agents')}</option>
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
            <option value="recent">{t('list.sort_recent')}</option>
            <option value="oldest">{t('list.sort_oldest')}</option>
            <option value="repo">{t('list.sort_repo')}</option>
            <option value="tokens">{t('list.sort_tokens')}</option>
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
          <button
            onClick={() => setStarredOnly(v => !v)}
            title="Show only starred"
            className={`px-2 py-1 text-[11px] rounded border transition-colors flex-shrink-0 ${
              starredOnly
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ★
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto">
            <button
              onClick={() => setTagFilter('all')}
              className={`px-2 py-0.5 text-[10px] rounded flex-shrink-0 ${
                tagFilter === 'all'
                  ? 'bg-slate-700 text-slate-100'
                  : 'bg-slate-900 text-slate-500 hover:text-slate-300'
              }`}
            >all</button>
            {allTags.map((tg) => (
              <button
                key={tg}
                onClick={() => setTagFilter(tg)}
                className={`px-2 py-0.5 text-[10px] rounded flex-shrink-0 ${
                  tagFilter === tg
                    ? 'bg-violet-500/30 text-violet-100'
                    : 'bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
                }`}
              >#{tg}</button>
            ))}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {total === 0 ? (
          <div className="text-xs text-slate-600 text-center py-8">{t('list.empty')}</div>
        ) : useVirtual ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetTop}px)` }}>
              {visible.map((it, i) =>
                it.type === 'header' ? (
                  <button
                    key={`h:${it.key}`}
                    onClick={() => toggle(it.key)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                    style={{ height: HEADER_H }}
                  >
                    <span className={`transition-transform ${it.collapsed ? '-rotate-90' : ''}`}>▾</span>
                    {it.accent && <span className={it.accent}>●</span>}
                    <span className="font-semibold truncate">{it.label}</span>
                    <span className="ml-auto text-slate-600">{it.count}</span>
                  </button>
                ) : (
                  <div key={`r:${it.session.id}:${i}`}>{renderRow(it.session)}</div>
                )
              )}
            </div>
          </div>
        ) : (
          <>
            {renderGroup('active', 'Active', active, 'text-emerald-400')}
            {repoOrder.map(repo =>
              renderGroup(`repo:${repo}`, repo, byRepo.get(repo)!)
            )}
          </>
        )}
      </div>
    </aside>
  );
}
