import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { fetchSessions, fetchDetail, connectWs, fetchLabels, setLabel as apiSetLabel, type LabelMap } from './api';
import { estimateCostUsd, formatUsd } from './pricing';
import { toast } from './toast';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { OverviewPanel } from './components/OverviewPanel';
import { RealmPanel } from './components/RealmPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { PromptsPanel } from './components/PromptsPanel';
import { SidebarResizer } from './components/SidebarResizer';
import { ProgressBar } from './components/ProgressBar';
import { ToastContainer } from './components/ToastContainer';
import { Breadcrumbs } from './components/Breadcrumbs';
import { CommandPalette } from './components/CommandPalette';
import { LangToggle } from './components/LangToggle';
import { ThemeToggle } from './components/ThemeToggle';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useT } from './i18n';

type View = 'overview' | 'session' | 'realm' | 'skills' | 'prompts';

interface ViewSnapshot {
  view: View;
  selected: string | null;
  realmPage: string | null;
}

export default function App() {
  const { t } = useT();
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [view, setView] = useState<View>('overview');
  const [realmFilter, setRealmFilter] = useState<string | null>(null);
  const [realmPage, setRealmPage] = useState<string | null>(null);
  const [pendingSkill, setPendingSkill] = useState<{ name: string; n: number } | null>(null);
  const [pendingCategory, setPendingCategory] = useState<{ name: string; n: number } | null>(null);
  const [labels, setLabels] = useState<LabelMap>({});
  const [history, setHistory] = useState<ViewSnapshot[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState<string | undefined>(undefined);
  const [tokensMap, setTokensMap] = useState<Record<string, { in: number; out: number }>>({});
  const [pulseMap, setPulseMap] = useState<Record<string, { bins: number[]; events: number }>>({});
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = parseInt(localStorage.getItem('pawscope.sidebarWidth') ?? '', 10);
    return Number.isFinite(v) && v >= 280 && v <= 720 ? v : 384;
  });

  useEffect(() => {
    localStorage.setItem('pawscope.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    fetchLabels().then(setLabels).catch(() => setLabels({}));
  }, []);

  const updateLabel = (id: string, label: { starred: boolean; tags: string[]; note?: string | null }) => {
    setLabels((prev) => ({ ...prev, [id]: label }));
    apiSetLabel(id, label).catch(() => toast.error('Failed to save label'));
  };
  const toggleStar = (id: string) => {
    const cur = labels[id] ?? { starred: false, tags: [], note: null };
    updateLabel(id, { ...cur, starred: !cur.starred });
  };

  useEffect(() => {
    fetchSessions().then(setSessions);
    fetch('/api/sessions/tokens').then(r => r.ok ? r.json() : {}).then(setTokensMap).catch(() => {});
    fetch('/api/sessions/pulse').then(r => r.ok ? r.json() : {}).then(setPulseMap).catch(() => {});
  }, []);

  useEffect(() => {
    const ws = connectWs(ev => {
      if (ev?.kind === 'session_list_changed') {
        fetchSessions().then(setSessions);
      } else if (ev?.kind === 'detail_updated' && selected === ev.session_id) {
        setDetail(ev.detail);
      }
    });
    return () => ws.close();
  }, [selected]);

  // Cmd/Ctrl+K opens command palette globally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fetch detail when `selected` changes (route to session view is handled by navigate()).
  useEffect(() => {
    if (selected) fetchDetail(selected).then(setDetail);
  }, [selected]);

  const navigate = (next: { view?: View; selected?: string | null; realmPage?: string | null }) => {
    const snap: ViewSnapshot = { view, selected, realmPage };
    const target: ViewSnapshot = {
      view: next.view ?? view,
      selected: next.selected !== undefined ? next.selected : selected,
      realmPage: next.realmPage !== undefined ? next.realmPage : realmPage,
    };
    // Skip if no change
    if (target.view === snap.view && target.selected === snap.selected && target.realmPage === snap.realmPage) {
      return;
    }
    setHistory((h) => [...h, snap]);
    setView(target.view);
    if (next.selected !== undefined) setSelected(target.selected);
    if (next.realmPage !== undefined) setRealmPage(target.realmPage);
  };

  const goBack = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setView(last.view);
      setSelected(last.selected);
      setRealmPage(last.realmPage);
      return h.slice(0, -1);
    });
  };

  const selectSession = (id: string | null) => navigate({ selected: id, view: id ? 'session' : view });

  const activeCount = sessions.filter(s => s.status === 'active').length;

  // Prev/next session navigation, sorted by last_event_at desc (matches default list order).
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const ta = a.last_event_at ? new Date(a.last_event_at).getTime() : 0;
      const tb = b.last_event_at ? new Date(b.last_event_at).getTime() : 0;
      return tb - ta;
    });
  }, [sessions]);
  const sessionPos = useMemo(() => {
    if (!selected || sortedSessions.length === 0) return null;
    const idx = sortedSessions.findIndex(s => s.id === selected);
    if (idx < 0) return null;
    return { idx, total: sortedSessions.length };
  }, [selected, sortedSessions]);
  const prevSession = sessionPos && sessionPos.idx > 0 ? sortedSessions[sessionPos.idx - 1].id : null;
  const nextSession = sessionPos && sessionPos.idx < sessionPos.total - 1 ? sortedSessions[sessionPos.idx + 1].id : null;

  // Build breadcrumbs from current state.
  const crumbs: { label: string; onClick?: () => void }[] = [
    { label: t('crumbs.overview'), onClick: () => navigate({ view: 'overview' }) },
  ];
  if (view === 'session') {
    crumbs.push({ label: `${t('crumbs.session')}${selected ? ` · ${selected.slice(0, 8)}` : ''}` });
  } else if (view === 'realm' && realmPage) {
    crumbs.push({ label: `${t('crumbs.realm')}: ${realmPage}` });
  } else if (view === 'skills') {
    crumbs.push({ label: t('crumbs.skills') });
  } else if (view === 'prompts') {
    crumbs.push({ label: t('crumbs.prompts') });
  }

  return (
    <div className="flex h-screen">
      <ProgressBar />
      <ToastContainer />
      <div
        className="flex flex-col border-r border-slate-800 bg-slate-950/50 flex-shrink-0"
        style={{ width: sidebarWidth }}
      >
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-slate-800/40">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="text-emerald-400 flex-shrink-0">
            <g fill="currentColor">
              <ellipse cx="12" cy="17" rx="5" ry="4" />
              <circle cx="6" cy="11" r="2.2" />
              <circle cx="9" cy="6.5" r="1.9" />
              <circle cx="15" cy="6.5" r="1.9" />
              <circle cx="18" cy="11" r="2.2" />
            </g>
          </svg>
          <span className="font-semibold text-slate-100 text-base tracking-tight">Pawscope</span>
          <TodayCostBadge sessions={sessions} tokensMap={tokensMap} t={t} />
        </div>
        <CostSparkline sessions={sessions} tokensMap={tokensMap} t={t} />
        <nav className="flex border-b border-slate-800">
          <button
            onClick={() => navigate({ view: 'overview' })}
            className={`flex-1 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
              view === 'overview'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.overview')}
          </button>
          <button
            onClick={() => navigate({ view: 'session' })}
            className={`flex-1 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
              view === 'session'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.session')}
            {activeCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">
                {activeCount}
              </span>
            )}
          </button>
          <button
            onClick={() => navigate({ view: 'skills' })}
            className={`flex-1 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
              view === 'skills'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.skills')}
          </button>
          <button
            onClick={() => navigate({ view: 'prompts' })}
            className={`flex-1 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
              view === 'prompts'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.prompts')}
          </button>
          <div className="px-2 flex items-center gap-1 border-l border-slate-800">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title={t('palette.tooltip')}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-400 hover:text-slate-200 font-mono"
            >⌘K</button>
            <ThemeToggle />
            <LangToggle />
          </div>
        </nav>
        <SessionList
          items={sessions}
          onSelect={selectSession}
          selected={selected}
          realmFilter={realmFilter}
          onClearRealmFilter={() => setRealmFilter(null)}
          labels={labels}
          onToggleStar={toggleStar}
          tokensMap={tokensMap}
          pulseMap={pulseMap}
        />
      </div>
      <SidebarResizer onResize={setSidebarWidth} />
      <main className="flex-1 flex flex-col min-w-0">
        <Breadcrumbs crumbs={crumbs} canBack={history.length > 0} onBack={goBack} />
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {view === 'overview' ? (
            <ErrorBoundary scope="Overview">
              <OverviewPanel
                onOpenSession={selectSession}
                onOpenRealm={(name: string) => navigate({ realmPage: name, view: 'realm' })}
                onOpenSkill={(name: string) => {
                  setPendingSkill(p => ({ name, n: (p?.n ?? 0) + 1 }));
                  navigate({ view: 'skills' });
                }}
                onOpenCategory={(name: string) => {
                  setPendingCategory(p => ({ name, n: (p?.n ?? 0) + 1 }));
                  navigate({ view: 'skills' });
                }}
                onOpenSearch={(q: string) => { setPaletteQuery(q); setPaletteOpen(true); }}
              />
            </ErrorBoundary>
          ) : view === 'realm' && realmPage ? (
            <ErrorBoundary scope="Realm">
              <RealmPanel
                name={realmPage}
                onOpenSession={selectSession}
                onBack={goBack}
              />
            </ErrorBoundary>
          ) : view === 'skills' ? (
            <ErrorBoundary scope="Skills">
              <SkillsPanel
                onOpenSession={selectSession}
                autoOpen={pendingSkill?.name ?? null}
                autoOpenNonce={pendingSkill?.n ?? 0}
                autoCategory={pendingCategory?.name ?? null}
                autoCategoryNonce={pendingCategory?.n ?? 0}
              />
            </ErrorBoundary>
          ) : view === 'prompts' ? (
            <ErrorBoundary scope="Prompts">
              <PromptsPanel onOpenSession={selectSession} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary scope="Session detail">
              <SessionDetail
                meta={sessions.find(s => s.id === selected)}
                detail={detail}
                onOpenSkill={(name: string) => {
                  setPendingSkill(p => ({ name, n: (p?.n ?? 0) + 1 }));
                  navigate({ view: 'skills' });
                }}
                label={selected ? labels[selected] : undefined}
                onSetLabel={selected ? (lbl) => updateLabel(selected, lbl) : undefined}
                onPrev={prevSession ? () => selectSession(prevSession) : undefined}
                onNext={nextSession ? () => selectSession(nextSession) : undefined}
                position={sessionPos ? { index: sessionPos.idx + 1, total: sessionPos.total } : undefined}
              />
            </ErrorBoundary>
          )}
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); setPaletteQuery(undefined); }}
        sessions={sessions}
        labels={labels}
        initialQuery={paletteQuery}
        onOpenSession={(id) => selectSession(id)}
        onOpenSkill={(name) => {
          setPendingSkill(p => ({ name, n: (p?.n ?? 0) + 1 }));
          navigate({ view: 'skills' });
        }}
      />
    </div>
  );
}

function TodayCostBadge({ sessions, tokensMap, t }: {
  sessions: any[];
  tokensMap: Record<string, { in: number; out: number }>;
  t: (k: string) => string;
}) {
  type Period = 'today' | 'week' | 'month';
  const [period, setPeriod] = useState<Period>(() => (localStorage.getItem('pawscope.costPeriod') as Period) || 'today');
  const [open, setOpen] = useState(false);
  useEffect(() => { localStorage.setItem('pawscope.costPeriod', period); }, [period]);
  const { cost, count } = useMemo(() => {
    const now = new Date();
    let cutoff: Date;
    if (period === 'today') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    } else {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    let total = 0, n = 0;
    for (const s of sessions) {
      if (!s.last_event_at) continue;
      const dt = new Date(s.last_event_at);
      if (dt < cutoff) continue;
      const tk = tokensMap[s.id];
      if (!tk) continue;
      const c = estimateCostUsd(s.model, tk.in, tk.out);
      if (c !== null) { total += c; n += 1; }
    }
    return { cost: total, count: n };
  }, [sessions, tokensMap, period]);
  const label = period === 'today' ? t('misc.today_cost') : period === 'week' ? t('misc.week_cost') : t('misc.month_cost');
  if (count === 0 && period === 'today') return null;
  return (
    <div className="ml-auto relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 tabular-nums hover:bg-emerald-500/20 transition-colors flex items-center gap-1"
        title={`${count} sessions · ${formatUsd(cost)}`}
      >
        <span>{label} · {formatUsd(cost)}</span>
        <span className="text-emerald-400/60 text-[8px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 rounded-md bg-slate-900 border border-slate-700 shadow-lg overflow-hidden text-[11px] min-w-[110px]">
          {(['today','week','month'] as Period[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => { setPeriod(p); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left hover:bg-slate-800 transition-colors ${p === period ? 'text-emerald-300 bg-slate-800/60' : 'text-slate-300'}`}
            >
              {p === 'today' ? t('misc.today_cost') : p === 'week' ? t('misc.week_cost') : t('misc.month_cost')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CostSparkline({ sessions, tokensMap, t }: {
  sessions: any[];
  tokensMap: Record<string, { in: number; out: number }>;
  t: (k: string) => string;
}) {
  const [budget, setBudget] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('pawscope.dailyBudget') ?? '');
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const editBudget = () => {
    const cur = budget > 0 ? budget.toString() : '1.00';
    const raw = window.prompt(t('misc.budget_prompt'), cur);
    if (raw === null) return;
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) return;
    setBudget(v);
    if (v > 0) localStorage.setItem('pawscope.dailyBudget', String(v));
    else localStorage.removeItem('pawscope.dailyBudget');
  };
  const days7 = useMemo(() => {
    const today = new Date();
    const buckets: { label: string; cost: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, cost: 0 });
    }
    for (const s of sessions) {
      if (!s.last_event_at) continue;
      const dt = new Date(s.last_event_at);
      const sd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const diff = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - sd.getTime()) / 86400000);
      if (diff < 0 || diff > 6) continue;
      const tk = tokensMap[s.id];
      if (!tk) continue;
      const c = estimateCostUsd(s.model, tk.in, tk.out);
      if (c === null) continue;
      buckets[6 - diff].cost += c;
    }
    return buckets;
  }, [sessions, tokensMap]);
  const total = days7.reduce((a, b) => a + b.cost, 0);
  if (total <= 0) return null;
  const max = Math.max(...days7.map(d => d.cost), budget, 0.0001);
  const W = 100, H = 28;
  const pts = days7.map((d, i) => {
    const x = (i / (days7.length - 1)) * W;
    const y = H - (d.cost / max) * (H - 4) - 2;
    return [x, y, d.cost > budget && budget > 0] as [number, number, boolean];
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H} L0,${H} Z`;
  const overCount = pts.filter(p => p[2]).length;
  const budgetY = budget > 0 ? H - (budget / max) * (H - 4) - 2 : null;
  return (
    <div className="px-4 py-2 border-b border-slate-800/40">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span className="uppercase tracking-wider">{t('misc.cost7_trend')}</span>
        <span className="flex items-center gap-1">
          {overCount > 0 && (
            <span className="text-rose-400" title={t('misc.over_budget_days').replace('{n}', String(overCount))}>⚠</span>
          )}
          <button
            onClick={editBudget}
            className="text-emerald-400 font-mono tabular-nums hover:text-emerald-300"
            title={budget > 0 ? `${t('misc.daily_budget')}: ${formatUsd(budget)} — ${t('misc.click_to_edit')}` : t('misc.set_budget')}
          >
            {formatUsd(total)}
          </button>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-7">
        <defs>
          <linearGradient id="costGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(16,185,129,0.4)" />
            <stop offset="100%" stopColor="rgba(16,185,129,0)" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#costGrad)" />
        <path d={path} stroke="#34d399" strokeWidth="1" fill="none" />
        {budgetY !== null && (
          <line
            x1="0" x2={W} y1={budgetY} y2={budgetY}
            stroke="#fb7185" strokeWidth="0.6" strokeDasharray="2,2" opacity="0.7"
          >
            <title>{`${t('misc.daily_budget')}: ${formatUsd(budget)}`}</title>
          </line>
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.2" fill={p[2] ? '#fb7185' : '#34d399'}>
            <title>{`${days7[i].label}: ${formatUsd(days7[i].cost)}${p[2] ? ' ⚠' : ''}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[8px] text-slate-600 tabular-nums mt-0.5">
        <span>{days7[0].label}</span>
        <span>{days7[days7.length - 1].label}</span>
      </div>
    </div>
  );
}
