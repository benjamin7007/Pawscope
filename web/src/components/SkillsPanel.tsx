import { useEffect, useMemo, useState } from 'react';
import { fetchSkills, fetchSkillContent, type SkillEntry, type SkillContent } from '../api';
import { useT } from '../i18n';
import { renderMarkdown } from '../markdown';

const SOURCE_LABELS: Record<string, string> = {
  'copilot-superpowers': 'Copilot · superpowers',
  'claude-skills': 'Claude · skills',
  'agents-skills': 'Agents · skills',
};

const SOURCE_COLORS: Record<string, string> = {
  'copilot-superpowers': '#34d399',
  'claude-skills': '#a78bfa',
  'agents-skills': '#f59e0b',
};

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [bySource, setBySource] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<string>('all');
  const [usedOnly, setUsedOnly] = useState(false);
  const [openSkill, setOpenSkill] = useState<SkillEntry | null>(null);
  const [openContent, setOpenContent] = useState<SkillContent | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const { t, fmt, lang } = useT();

  useEffect(() => {
    if (!openSkill) {
      setOpenContent(null);
      setOpenErr(null);
      return;
    }
    let cancelled = false;
    setOpenContent(null);
    setOpenErr(null);
    fetchSkillContent(openSkill.path)
      .then(d => !cancelled && setOpenContent(d))
      .catch(e => !cancelled && setOpenErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [openSkill]);

  useEffect(() => {
    let cancelled = false;
    fetchSkills()
      .then(d => {
        if (cancelled) return;
        setSkills(d.skills);
        setBySource(d.by_source);
      })
      .catch(e => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!skills) return [];
    const q = filter.trim().toLowerCase();
    return skills.filter(s => {
      if (source !== 'all' && s.source !== source) return false;
      if (usedOnly && s.invocations === 0) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, filter, source, usedOnly]);

  const usedCount = skills?.filter(s => s.invocations > 0).length ?? 0;

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;
  if (!skills) {
    return (
      <main className="flex-1 p-8 text-slate-500 text-sm">
        {lang === 'zh' ? '加载技能中…' : 'Loading skills…'}
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-5 pb-4 border-b border-slate-800">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
          {lang === 'zh' ? '技能集' : 'Skills'}
        </div>
        <h1 className="text-2xl font-semibold mt-1 text-slate-100">
          {lang === 'zh' ? `本地技能 · ${fmt(skills.length)} 个` : `Local skills · ${fmt(skills.length)}`}
        </h1>
        <div className="text-xs text-slate-500 mt-1">
          {lang === 'zh'
            ? `已被会话调用过的：${fmt(usedCount)} / ${fmt(skills.length)}`
            : `Used in sessions: ${fmt(usedCount)} / ${fmt(skills.length)}`}
        </div>
      </header>

      <div className="px-8 py-4 flex flex-wrap gap-3 items-center border-b border-slate-800/60 bg-slate-900/30">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={lang === 'zh' ? '搜索名称或描述…' : 'Search name or description…'}
          className="flex-1 min-w-[240px] bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
        />
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="all">{lang === 'zh' ? '全部来源' : 'All sources'}</option>
          {Object.entries(bySource).map(([k, v]) => (
            <option key={k} value={k}>
              {SOURCE_LABELS[k] ?? k} ({v})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={usedOnly} onChange={e => setUsedOnly(e.target.checked)} />
          {lang === 'zh' ? '仅显示被调用过的' : 'Used only'}
        </label>
      </div>

      <ul className="divide-y divide-slate-800/60">
        {filtered.map(s => (
          <li key={`${s.source}|${s.path}`}>
            <button
              type="button"
              onClick={() => setOpenSkill(s)}
              className="w-full text-left px-8 py-3 hover:bg-slate-900/50 transition-colors cursor-pointer"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-slate-100 text-sm font-semibold">{s.name}</span>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    background: `${SOURCE_COLORS[s.source] ?? '#64748b'}22`,
                    color: SOURCE_COLORS[s.source] ?? '#94a3b8',
                    border: `1px solid ${SOURCE_COLORS[s.source] ?? '#64748b'}55`,
                  }}
                >
                  {SOURCE_LABELS[s.source] ?? s.source}
                </span>
                {s.invocations > 0 && (
                  <span className="text-[11px] text-emerald-300 tabular-nums">
                    ×{fmt(s.invocations)}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-slate-600 font-mono truncate max-w-[420px]" title={s.path}>
                  {s.path.replace(/^.*\.(copilot|claude|agents)\//, '~/.$1/')}
                </span>
              </div>
              {s.description && (
                <div className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {s.description}
                </div>
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-8 py-12 text-center text-sm text-slate-600">
            {lang === 'zh' ? '没有匹配的技能。' : 'No skills match.'}
          </li>
        )}
      </ul>
      {openSkill && (
        <SkillDrawer
          skill={openSkill}
          content={openContent}
          err={openErr}
          onClose={() => setOpenSkill(null)}
        />
      )}
      {/* keep linter happy */}
      <div className="hidden">{t('nav.overview')}</div>
    </main>
  );
}

function SkillDrawer({
  skill,
  content,
  err,
  onClose,
}: {
  skill: SkillEntry;
  content: SkillContent | null;
  err: string | null;
  onClose: () => void;
}) {
  const { lang, fmt } = useT();
  const html = useMemo(() => (content ? renderMarkdown(content.content) : ''), [content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative w-full max-w-2xl h-full bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col">
        <header className="px-5 py-3 border-b border-slate-800 flex items-baseline gap-3">
          <span className="font-mono text-slate-100 text-base font-semibold">{skill.name}</span>
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[300px]" title={skill.path}>
            {skill.path.replace(/^.*\.(copilot|claude|agents)\//, '~/.$1/')}
          </span>
          {content && (
            <span className="text-[10px] text-slate-600 tabular-nums">
              {fmt(content.bytes)} {lang === 'zh' ? '字节' : 'bytes'}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto text-slate-500 hover:text-slate-200 text-sm px-2"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm">
          {err && <div className="text-rose-400 text-xs">{err}</div>}
          {!err && !content && (
            <div className="text-slate-500 text-xs">
              {lang === 'zh' ? '加载中…' : 'Loading…'}
            </div>
          )}
          {content && (
            // eslint-disable-next-line react/no-danger -- output is escaped by renderMarkdown
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </aside>
    </div>
  );
}
