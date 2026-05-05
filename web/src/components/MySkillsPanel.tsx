import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchMySkills, removeMySkill, updateMySkill, authStatus, authLogin, authLogout, syncAll,
  fetchRemoteSkills, fetchProjects, installSkill,
  type MySkillEntry, type RemoteSkill, type Project,
} from '../api';
import { useT } from '../i18n';
import { toast } from '../toast';

export function MySkillsPanel() {
  const { t, rel } = useT();
  const [skills, setSkills] = useState<MySkillEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortMode, setSortMode] = useState<'custom' | 'name' | 'date' | 'category'>('custom');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Sync state
  const [authState, setAuthState] = useState<{logged_in: boolean, user?: {login: string, avatar_url: string, name: string}, sync_repo?: string, last_sync?: string} | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginToken, setLoginToken] = useState('');
  const [loginRepo, setLoginRepo] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Remote skills state
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    try {
      const data = await fetchMySkills();
      setSkills(data.skills);
      setCategories(data.categories);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Load auth status on mount
  useEffect(() => {
    authStatus().then(setAuthState).catch(() => {});
  }, []);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      await authLogin(loginToken, loginRepo);
      const status = await authStatus();
      setAuthState(status);
      setShowLogin(false);
      setLoginToken('');
      setLoginRepo('');
      toast.success(t('sync.login_success_toast'));
    } catch (e) {
      setLoginError(String(e));
      toast.error(`${t('sync.login_failed')}: ${e}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await authLogout();
    setAuthState({ logged_in: false });
    toast.info(t('sync.logged_out_toast'));
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await syncAll();
      setSyncMessage(`${t('sync.success')} — ⬇${result.pulled} ⬆${result.pushed}`);
      await reload();
      const status = await authStatus();
      setAuthState(status);
      setTimeout(() => setSyncMessage(''), 4000);
      toast.success(t('sync.sync_complete_toast'));
    } catch (e) {
      setSyncMessage(`❌ ${e}`);
      toast.error(`${t('sync.sync_failed')}: ${e}`);
    } finally {
      setSyncing(false);
    }
  };

  // Load remote skills when logged in
  const loadRemoteSkills = async () => {
    setRemoteLoading(true);
    try {
      const [rs, ps] = await Promise.all([fetchRemoteSkills(), fetchProjects()]);
      setRemoteSkills(rs.skills);
      setProjects(ps.projects);
    } catch {
      // silently ignore
    } finally {
      setRemoteLoading(false);
    }
  };

  useEffect(() => {
    if (authState?.logged_in) {
      loadRemoteSkills();
    } else {
      setRemoteSkills([]);
    }
  }, [authState?.logged_in]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInstall = async (name: string, target: 'global' | 'project', projectPath?: string) => {
    setInstallingSkill(name);
    setOpenDropdown(null);
    try {
      const result = await installSkill(name, target, projectPath);
      setInstallMessage(`✅ ${t('sync.install_success')} → ${result.installed_to}`);
      setRemoteSkills(prev => prev.map(s => s.name === name ? { ...s, installed: true } : s));
      setTimeout(() => setInstallMessage(''), 4000);
      toast.success(`${t('sync.install_success')}: ${name}`);
    } catch (e) {
      setInstallMessage(`❌ ${e}`);
      setTimeout(() => setInstallMessage(''), 4000);
      toast.error(`${t('sync.install_failed')}: ${e}`);
    } finally {
      setInstallingSkill(null);
    }
  };

  const sorted = useMemo(() => {
    let list = [...skills];
    const q = query.toLowerCase().trim();
    if (q) list = list.filter(s => s.name.includes(q) || s.description.toLowerCase().includes(q));
    if (categoryFilter !== 'all') list = list.filter(s => s.category === categoryFilter);
    switch (sortMode) {
      case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'date': list.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()); break;
      case 'category': list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)); break;
      case 'custom': list.sort((a, b) => a.sort_order - b.sort_order); break;
    }
    return list;
  }, [skills, query, categoryFilter, sortMode]);

  const handleDelete = async (id: string) => {
    try {
      await removeMySkill(id);
      setSkills(prev => prev.filter(s => s.id !== id));
      setConfirmDelete(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCategoryChange = async (id: string, newCategory: string) => {
    try {
      await updateMySkill(id, { category: newCategory });
      setSkills(prev => prev.map(s => s.id === id ? { ...s, category: newCategory } : s));
      setEditingCategory(null);
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="h-10 bg-slate-800 rounded w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 bg-slate-800/50 rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <header>
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
          {t('my_skills.kicker')}
        </div>
        <h2 className="text-xl font-semibold text-slate-100">{t('my_skills.title')}</h2>
      </header>

      {/* Sync bar */}
      {authState && (
        <div className="flex items-center gap-3 px-3 py-2 rounded border border-slate-800 bg-slate-900/60 text-sm flex-wrap">
          {authState.logged_in && authState.user ? (
            <>
              <img src={authState.user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
              <span className="text-slate-300 text-xs">{authState.user.login}</span>
              <span className="text-slate-600 text-xs">·</span>
              <span className="text-slate-500 text-xs">{t('sync.connected')} {authState.sync_repo}</span>
              {authState.last_sync && (
                <>
                  <span className="text-slate-600 text-xs">·</span>
                  <span className="text-slate-500 text-[11px]">{t('sync.last_sync')}: {rel(authState.last_sync)}</span>
                </>
              )}
              {syncMessage && (
                <span className={`text-[11px] px-2 py-0.5 rounded ${syncMessage.startsWith('❌') ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                  {syncMessage}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-2.5 py-1 text-[11px] rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                >
                  {syncing ? t('sync.syncing') : t('sync.sync')}
                </button>
                <button
                  onClick={handleLogout}
                  className="px-2 py-1 text-[11px] rounded border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
                >
                  🚪 {t('sync.logout')}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="px-3 py-1.5 text-[11px] rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
              {t('sync.login_github')}
            </button>
          )}
        </div>
      )}

      {/* Login dialog */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-100">{t('sync.login_title')}</h3>
            <p className="text-[11px] text-slate-500">{t('sync.login_hint')}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('sync.token_label')}</label>
                <input
                  type="password"
                  value={loginToken}
                  onChange={e => setLoginToken(e.target.value)}
                  placeholder={t('sync.token_placeholder')}
                  className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
                />
                <p className="text-[10px] text-slate-600 mt-1">{t('sync.pat_hint')}</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('sync.repo_label')}</label>
                <input
                  value={loginRepo}
                  onChange={e => setLoginRepo(e.target.value)}
                  placeholder={t('sync.repo_placeholder')}
                  className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>
            {loginError && (
              <div className="text-rose-400 text-xs p-2 bg-rose-500/10 rounded border border-rose-500/30">{loginError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowLogin(false); setLoginError(''); }}
                className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:text-slate-200"
              >
                {t('sync.cancel')}
              </button>
              <button
                onClick={handleLogin}
                disabled={loginLoading || !loginToken || !loginRepo}
                className="px-3 py-1.5 text-xs rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {loginLoading ? '...' : t('sync.login_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote Skills section */}
      {authState?.logged_in && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200">☁️ {t('sync.remote_skills')}</h3>
            {remoteLoading ? (
              <span className="text-[11px] text-slate-500">{t('sync.syncing')}</span>
            ) : (
              <span className="text-[11px] text-slate-500">({remoteSkills.length} {t('sync.available')})</span>
            )}
          </div>
          {installMessage && (
            <div className={`text-[11px] px-3 py-1.5 rounded ${installMessage.startsWith('❌') ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'}`}>
              {installMessage}
            </div>
          )}
          {remoteSkills.length > 0 ? (
            <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 bg-slate-900/40" ref={dropdownRef}>
              {remoteSkills.map(skill => (
                <div key={skill.name} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">{skill.name}</span>
                      {skill.installed && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-300">
                          ✅ {t('sync.installed')}
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{skill.description}</p>
                    )}
                  </div>
                  <div className="relative flex-shrink-0">
                    {installingSkill === skill.name ? (
                      <span className="px-2.5 py-1 text-[11px] text-slate-400">{t('sync.installing')}</span>
                    ) : (
                      <button
                        onClick={() => setOpenDropdown(openDropdown === skill.name ? null : skill.name)}
                        className="px-2.5 py-1 text-[11px] rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors"
                      >
                        {t('sync.install')} ▾
                      </button>
                    )}
                    {openDropdown === skill.name && (
                      <div className="absolute right-0 top-8 z-50 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                        <button
                          onClick={() => handleInstall(skill.name, 'global')}
                          className="w-full text-left px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700 transition-colors"
                        >
                          🌐 {t('sync.install_global')}
                        </button>
                        {projects.length > 0 && (
                          <>
                            <div className="border-t border-slate-700" />
                            {projects.map(proj => (
                              <button
                                key={proj.path}
                                onClick={() => handleInstall(skill.name, 'project', proj.path)}
                                className="w-full text-left px-3 py-2 text-[12px] text-slate-300 hover:bg-slate-700 transition-colors truncate"
                                title={proj.path}
                              >
                                📁 {proj.name}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : !remoteLoading ? (
            <div className="text-center py-6 text-slate-500 text-[11px]">{t('sync.no_remote')}</div>
          ) : null}
        </div>
      )}

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('my_skills.search_ph')}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        {/* Category filter */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-2.5 py-1.5 text-[11px] rounded border transition-colors ${
              categoryFilter === 'all'
                ? 'bg-slate-700 border-slate-600 text-slate-100'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {t('my_skills.filter_all')} ({skills.length})
          </button>
          {categories.map(cat => {
            const count = skills.filter(s => s.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1.5 text-[11px] rounded border transition-colors whitespace-nowrap ${
                  categoryFilter === cat
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
        {/* Sort mode */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">{t('my_skills.sort')}:</span>
          {(['custom', 'name', 'date', 'category'] as const).map(m => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                sortMode === m
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              {t(`my_skills.sort_${m}`)}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          <span className="text-emerald-300 font-semibold">{skills.length}</span> {t('my_skills.total_label')}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-rose-400 text-sm p-2 bg-rose-500/10 rounded border border-rose-500/30">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-rose-300 hover:text-rose-100">✕</button>
        </div>
      )}

      {/* Grid */}
      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map(skill => (
            <div
              key={skill.id}
              className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-100 truncate">{skill.name}</h3>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                      skill.origin_kind === 'store'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      {skill.origin_kind === 'store' ? '🌐 Store' : '📁 Local'}
                    </span>
                    {skill.missing && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-300">Missing</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{skill.description}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1">
                  {confirmDelete === skill.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(skill.id)}
                        className="px-2 py-1 text-[11px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                      >
                        {t('my_skills.confirm')}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 text-[11px] rounded bg-slate-800 text-slate-400 border border-slate-700"
                      >
                        {t('my_skills.cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(skill.id)}
                      className="px-2 py-1 text-[11px] rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      title={t('my_skills.delete')}
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                {/* Category tag - click to edit */}
                {editingCategory === skill.id ? (
                  <input
                    autoFocus
                    defaultValue={skill.category}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== skill.category) handleCategoryChange(skill.id, v);
                      else setEditingCategory(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingCategory(null);
                    }}
                    className="px-1.5 py-0.5 text-[10px] bg-slate-800 border border-emerald-500/40 rounded text-emerald-300 outline-none w-24"
                    placeholder="category"
                  />
                ) : (
                  <button
                    onClick={() => setEditingCategory(skill.id)}
                    className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                    title={t('my_skills.edit_category')}
                  >
                    {skill.category || t('my_skills.uncategorized')}
                  </button>
                )}
                <span>·</span>
                <span>{new Date(skill.added_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">📚</div>
          <p className="text-sm">{query ? t('my_skills.no_results') : t('my_skills.empty')}</p>
          <p className="text-[11px] mt-1">{t('my_skills.empty_hint')}</p>
        </div>
      )}
    </main>
  );
}
