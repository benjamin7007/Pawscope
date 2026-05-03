import { useEffect, useMemo, useState } from 'react';
import {
  fetchStoreCatalog,
  installStoreSkill,
  uninstallStoreSkill,
  refreshStoreCatalog,
  fetchStoreSkillDetail,
  type StoreCatalog,
} from '../api';
import { useT } from '../i18n';

interface Props {
  onOpenSkills?: () => void;
  projectPath?: string | null;
}

export function StorePanel({ onOpenSkills: _onOpenSkills, projectPath }: Props) {
  const { t } = useT();
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState<Record<string, string>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'not_installed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    fetchStoreCatalog(projectPath ?? undefined)
      .then(setCatalog)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectPath]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.toLowerCase().trim();
    return catalog.skills.filter(s => {
      if (filterMode === 'installed' && !s.installed) return false;
      if (filterMode === 'not_installed' && s.installed) return false;
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (!q) return true;
      return s.name.includes(q) || s.description.toLowerCase().includes(q);
    });
  }, [catalog, query, filterMode, categoryFilter]);

  const installedCount = catalog?.skills.filter(s => s.installed).length ?? 0;

  const handleInstall = async (name: string, scope?: 'project' | 'global') => {
    const s = scope ?? (projectPath ? 'project' : 'global');
    setInstalling(name);
    try {
      await installStoreSkill(name, s, projectPath ?? undefined);
      setCatalog(prev =>
        prev
          ? {
              ...prev,
              skills: prev.skills.map(sk => (sk.name === name ? { ...sk, installed: true, installed_scope: s } : sk)),
            }
          : prev,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (name: string, scope?: 'project' | 'global') => {
    const s = scope ?? (projectPath ? 'project' : 'global');
    setInstalling(name);
    try {
      await uninstallStoreSkill(name, s, projectPath ?? undefined);
      setCatalog(prev =>
        prev
          ? {
              ...prev,
              skills: prev.skills.map(sk => (sk.name === name ? { ...sk, installed: false, installed_scope: 'none' } : sk)),
            }
          : prev,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshStoreCatalog();
      const cat = await fetchStoreCatalog();
      setCatalog(cat);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async (name: string) => {
    if (expandedSkill === name) {
      setExpandedSkill(null);
      return;
    }
    setExpandedSkill(name);
    if (!skillContent[name]) {
      try {
        const detail = await fetchStoreSkillDetail(name);
        setSkillContent(prev => ({ ...prev, [name]: detail.content }));
      } catch {
        /* ignore */
      }
    }
  };

  if (loading && !catalog) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="h-10 bg-slate-800 rounded w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-32 bg-slate-800/50 rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (error && !catalog) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="text-rose-400 text-sm">
          {t('store.error')}: {error}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
            {t('store.kicker')}
          </div>
          <h1 className="text-xl font-semibold text-slate-100">{t('store.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          {catalog?.last_updated && (
            <span className="text-[10px] text-slate-500">
              {t('store.last_updated')}: {new Date(catalog.last_updated).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100 disabled:opacity-50"
          >
            ↻ {t('store.refresh')}
          </button>
        </div>
      </header>

      {/* Stats + search */}
      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('store.search_ph')}
          className="flex-1 px-3 py-2 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        <div className="flex items-center gap-1.5">
          {(['all', 'installed', 'not_installed'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-2.5 py-1.5 text-[11px] rounded border transition-colors ${
                filterMode === mode
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(`store.filter_${mode}`)}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          <span className="text-emerald-300 font-semibold">{installedCount}</span> /{' '}
          {catalog?.total ?? 0} {t('store.installed_label')}
        </div>
      </div>

      {/* Source badge + project context */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span>📦 {t('store.source')}: </span>
        <a
          href="https://github.com/github/awesome-copilot"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-300 hover:underline"
        >
          github/awesome-copilot
        </a>
        {catalog?.commit_sha && (
          <span className="font-mono text-slate-600">@ {catalog.commit_sha.slice(0, 7)}</span>
        )}
        <span className="mx-1 text-slate-700">·</span>
        {projectPath ? (
          <span className="text-blue-300" title={projectPath}>
            📁 {projectPath.split('/').slice(-2).join('/')}
          </span>
        ) : (
          <span className="text-slate-600 italic">No project selected</span>
        )}
      </div>

      {/* Category filter */}
      {catalog && catalog.categories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-2.5 py-1 text-[11px] rounded border whitespace-nowrap transition-colors flex-shrink-0 ${
              categoryFilter === 'all'
                ? 'bg-slate-700 border-slate-600 text-slate-100'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {t('store.filter_all')} ({catalog.total})
          </button>
          {catalog.categories.map(cat => (
            <button
              key={cat.name}
              onClick={() => setCategoryFilter(cat.name)}
              className={`px-2.5 py-1 text-[11px] rounded border whitespace-nowrap transition-colors flex-shrink-0 ${
                categoryFilter === cat.name
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(skill => (
          <div
            key={skill.name}
            className={`bg-slate-900/40 border rounded-lg p-3 transition-colors cursor-pointer hover:border-slate-600 ${
              expandedSkill === skill.name
                ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                : 'border-slate-800'
            }`}
            onClick={() => toggleExpand(skill.name)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100 truncate">{skill.name}</h3>
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 whitespace-nowrap">
                    {skill.category}
                  </span>
                  {skill.installed && (
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                      skill.installed_scope === 'project'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {skill.installed_scope === 'project' ? '📁 Project' : '🌐 Global'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                  {skill.description}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                {skill.installed ? (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleUninstall(skill.name, skill.installed_scope as 'project' | 'global');
                    }}
                    disabled={installing === skill.name}
                    className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                      installing === skill.name
                        ? 'bg-slate-700 text-slate-500 cursor-wait'
                        : 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30'
                    }`}
                  >
                    {installing === skill.name ? '...' : t('store.uninstall')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleInstall(skill.name, 'project');
                      }}
                      disabled={installing === skill.name || !projectPath}
                      title={projectPath ? `Install to ${projectPath}` : 'Select a session first'}
                      className={`px-2 py-1 text-[11px] rounded font-medium transition-colors ${
                        installing === skill.name
                          ? 'bg-slate-700 text-slate-500 cursor-wait'
                          : !projectPath
                            ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                            : 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 border border-blue-500/30'
                      }`}
                    >
                      {installing === skill.name ? '...' : '📁'}
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleInstall(skill.name, 'global');
                      }}
                      disabled={installing === skill.name}
                      title="Install globally to ~/.copilot/skills/"
                      className={`px-2 py-1 text-[11px] rounded font-medium transition-colors ${
                        installing === skill.name
                          ? 'bg-slate-700 text-slate-500 cursor-wait'
                          : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30'
                      }`}
                    >
                      {installing === skill.name ? '...' : '🌐'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {skill.assets.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-600">
                <span>📎</span>
                <span>
                  {skill.assets.length} {t('store.assets')}
                </span>
              </div>
            )}
            {expandedSkill === skill.name && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                {skillContent[skill.name] ? (
                  <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto bg-slate-950/50 rounded p-2">
                    {skillContent[skill.name]}
                  </pre>
                ) : (
                  <div className="text-[11px] text-slate-500 animate-pulse">
                    {t('store.loading_detail')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-12 text-slate-500 text-sm">
          {query ? t('store.no_results') : t('store.empty')}
        </div>
      )}
    </main>
  );
}
