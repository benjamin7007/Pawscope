import { useEffect, useState } from 'react';
import './styles.css';
import { fetchSessions, fetchDetail, connectWs } from './api';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { OverviewPanel } from './components/OverviewPanel';
import { RealmPanel } from './components/RealmPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { LangToggle } from './components/LangToggle';
import { useT } from './i18n';

type View = 'overview' | 'session' | 'realm' | 'skills';

export default function App() {
  const { t } = useT();
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [view, setView] = useState<View>('overview');
  const [realmFilter, setRealmFilter] = useState<string | null>(null);
  const [realmPage, setRealmPage] = useState<string | null>(null);
  const [pendingSkill, setPendingSkill] = useState<{ name: string; n: number } | null>(null);

  useEffect(() => {
    fetchSessions().then(setSessions);
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

  useEffect(() => {
    if (selected) {
      fetchDetail(selected).then(setDetail);
      setView('session');
    }
  }, [selected]);

  const activeCount = sessions.filter(s => s.status === 'active').length;

  return (
    <div className="flex h-screen">
      <div className="w-80 flex flex-col border-r border-slate-800 bg-slate-950/50">
        <nav className="flex border-b border-slate-800">
          <button
            onClick={() => setView('overview')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              view === 'overview'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.overview')}
          </button>
          <button
            onClick={() => setView('session')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
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
            onClick={() => setView('skills')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              view === 'skills'
                ? 'bg-slate-800/80 text-slate-100 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            {t('nav.skills')}
          </button>
          <div className="px-2 flex items-center border-l border-slate-800">
            <LangToggle />
          </div>
        </nav>
        <SessionList
          items={sessions}
          onSelect={setSelected}
          selected={selected}
          realmFilter={realmFilter}
          onClearRealmFilter={() => setRealmFilter(null)}
        />
      </div>
      {view === 'overview' ? (
        <OverviewPanel
          onOpenSession={setSelected}
          onOpenRealm={(name: string) => {
            setRealmPage(name);
            setView('realm');
          }}
          onOpenSkill={(name: string) => {
            setPendingSkill(p => ({ name, n: (p?.n ?? 0) + 1 }));
            setView('skills');
          }}
        />
      ) : view === 'realm' && realmPage ? (
        <RealmPanel
          name={realmPage}
          onOpenSession={setSelected}
          onBack={() => {
            setRealmPage(null);
            setView('overview');
          }}
        />
      ) : view === 'skills' ? (
        <SkillsPanel
          onOpenSession={setSelected}
          autoOpen={pendingSkill?.name ?? null}
          autoOpenNonce={pendingSkill?.n ?? 0}
        />
      ) : (
        <SessionDetail
          meta={sessions.find(s => s.id === selected)}
          detail={detail}
          onOpenSkill={(name: string) => {
            setPendingSkill(p => ({ name, n: (p?.n ?? 0) + 1 }));
            setView('skills');
          }}
        />
      )}
    </div>
  );
}
