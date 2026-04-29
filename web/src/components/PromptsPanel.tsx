import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPrompts, type PromptHit, type PromptSearchFilters } from '../api';
import { useT } from '../i18n';

const AGENT_BADGE: Record<string, string> = {
  copilot: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  claude: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  codex: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const RANGE_HOURS: Record<string, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

function relTime(ts: string | null): string {
  if (!ts) return '';
  const dt = new Date(ts).getTime();
  if (!Number.isFinite(dt)) return '';
  const diff = Date.now() - dt;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/30 text-amber-100 px-0.5 rounded-sm">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

interface Props {
  onOpenSession: (id: string) => void;
}

interface PromptHitFull extends PromptHit {
  text: string;
}

export function PromptsPanel({ onOpenSession }: Props) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState<string>('');
  const [repo, setRepo] = useState<string>('');
  const [range, setRange] = useState<string>('');
  const [hits, setHits] = useState<PromptHitFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<PromptHitFull | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters: PromptSearchFilters = useMemo(() => {
    const f: PromptSearchFilters = {};
    if (agent) f.agent = agent;
    if (repo.trim()) f.repo = repo.trim();
    if (range && RANGE_HOURS[range]) {
      const since = new Date(Date.now() - RANGE_HOURS[range] * 3600_000);
      f.since = since.toISOString();
    }
    return f;
  }, [agent, repo, range]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchPrompts(q.trim(), 100, filters)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, filters]);

  const filterActive = !!(agent || repo.trim() || range);

  const header = useMemo(() => {
    if (loading) return t('prompts.loading');
    if (q.trim() || filterActive) return `${hits.length} ${t('prompts.results')}`;
    return t('prompts.recent');
  }, [loading, hits.length, q, filterActive, t]);

  const selectClass =
    'bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      <div className="px-6 pt-6 pb-4 border-b border-slate-800/60">
        <h1 className="text-lg font-semibold text-slate-100 mb-3">{t('prompts.title')}</h1>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('prompts.placeholder')}
            className="w-full bg-slate-900 border border-slate-700 rounded-md pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="uppercase tracking-wider">{t('prompts.filter.agent')}</span>
            <select className={selectClass} value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">{t('prompts.filter.agent.all')}</option>
              <option value="copilot">copilot</option>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="uppercase tracking-wider">{t('prompts.filter.repo')}</span>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name"
              className={`${selectClass} w-44`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="uppercase tracking-wider">{t('prompts.filter.range')}</span>
            <select className={selectClass} value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="">{t('prompts.filter.range.all')}</option>
              <option value="24h">{t('prompts.filter.range.24h')}</option>
              <option value="7d">{t('prompts.filter.range.7d')}</option>
              <option value="30d">{t('prompts.filter.range.30d')}</option>
            </select>
          </label>
          {filterActive && (
            <button
              onClick={() => {
                setAgent('');
                setRepo('');
                setRange('');
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
            >
              {t('prompts.filter.clear')}
            </button>
          )}
          <span className="ml-auto text-[11px] uppercase tracking-wider text-slate-500">{header}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {hits.length === 0 && !loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">{t('prompts.empty')}</div>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {hits.map((h) => (
              <li
                key={`${h.session_id}::${h.prompt_id}`}
                onClick={() => setModal(h)}
                className="px-6 py-3 hover:bg-slate-900/60 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider ${
                      AGENT_BADGE[h.agent] ?? 'bg-slate-500/10 text-slate-300 border-slate-700'
                    }`}
                  >
                    {h.agent}
                  </span>
                  {h.repo && (
                    <span className="text-[11px] text-slate-400 truncate max-w-xs">{h.repo}</span>
                  )}
                  {h.branch && <span className="text-[11px] text-slate-500">· {h.branch}</span>}
                  <span className="ml-auto text-[11px] text-slate-500 font-mono">
                    {relTime(h.timestamp)}
                  </span>
                </div>
                <div className="text-sm text-slate-200 leading-snug line-clamp-2">
                  {highlight(h.snippet, q.trim())}
                </div>
                {h.summary && h.summary !== h.snippet && (
                  <div className="mt-1 text-[11px] text-slate-500 truncate">↳ {h.summary}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider ${
                  AGENT_BADGE[modal.agent] ?? 'bg-slate-500/10 text-slate-300 border-slate-700'
                }`}
              >
                {modal.agent}
              </span>
              {modal.repo && <span className="text-[11px] text-slate-400 truncate max-w-xs">{modal.repo}</span>}
              {modal.branch && <span className="text-[11px] text-slate-500">· {modal.branch}</span>}
              <span className="ml-auto text-[11px] text-slate-500 font-mono">{relTime(modal.timestamp)}</span>
              <button
                onClick={() => setModal(null)}
                className="ml-2 text-slate-500 hover:text-slate-200"
              >✕</button>
            </header>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              <pre className="text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed break-words">
                {modal.text || modal.snippet}
              </pre>
            </div>
            <footer className="px-5 py-2.5 border-t border-slate-800 flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-mono truncate flex-1">
                {modal.session_id}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(modal.text || modal.snippet)}
                className="px-2.5 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded"
              >Copy</button>
              <button
                onClick={() => { onOpenSession(modal.session_id); setModal(null); }}
                className="px-2.5 py-1 text-xs text-slate-100 bg-emerald-700 hover:bg-emerald-600 rounded"
              >Open session →</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
