import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { fetchSessions, fetchDetail, connectWs, fetchLabels, setLabel as apiSetLabel, type LabelMap } from './api';
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
        </div>
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
        />
      </div>
      <SidebarResizer onResize={setSidebarWidth} />
      <main className="flex-1 flex flex-col min-w-0">
        <Breadcrumbs crumbs={crumbs} canBack={history.length > 0} onBack={goBack} />
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {view === 'overview' ? (
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
          ) : view === 'realm' && realmPage ? (
            <RealmPanel
              name={realmPage}
              onOpenSession={selectSession}
              onBack={goBack}
            />
          ) : view === 'skills' ? (
            <SkillsPanel
              onOpenSession={selectSession}
              autoOpen={pendingSkill?.name ?? null}
              autoOpenNonce={pendingSkill?.n ?? 0}
              autoCategory={pendingCategory?.name ?? null}
              autoCategoryNonce={pendingCategory?.n ?? 0}
            />
          ) : view === 'prompts' ? (
            <PromptsPanel onOpenSession={selectSession} />
          ) : (
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
          )}
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); setPaletteQuery(undefined); }}
        sessions={sessions}
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
