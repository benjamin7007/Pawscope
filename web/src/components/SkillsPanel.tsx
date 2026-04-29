import { useEffect, useMemo, useState } from 'react';
import { fetchSkills, fetchSkillContent, fetchSkillUsage, revealSkill, type SkillEntry, type SkillContent, type SkillUsage } from '../api';
import { useT } from '../i18n';
import { renderMarkdown } from '../markdown';
import { categorize, CATEGORY_ORDER, categoryLabel, popularityFor, summaryFor, languageTagFor } from '../skillCategory';
import { CategoryDonut } from './CategoryDonut';
import { SkillsSkeleton } from './Skeleton';

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

export function SkillsPanel({
  onOpenSession,
  autoOpen,
  autoOpenNonce,
  autoCategory,
  autoCategoryNonce,
}: {
  onOpenSession?: (id: string) => void;
  autoOpen?: string | null;
  autoOpenNonce?: number;
  autoCategory?: string | null;
  autoCategoryNonce?: number;
} = {}) {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [bySource, setBySource] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<string>('all');
  const [usedOnly, setUsedOnly] = useState(false);
  const [sort, setSort] = useState<'invocations' | 'name' | 'source'>('invocations');
  const [category, setCategory] = useState<string>('all');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('pawscope.skills.collapsed');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('pawscope.skills.collapsed', JSON.stringify(collapsed));
    } catch {
      // ignore quota / privacy-mode failures
    }
  }, [collapsed]);
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

  // Auto-open a specific skill by name (used when navigating from Overview Top skills).
  useEffect(() => {
    if (!autoOpen || !skills) return;
    const hit = skills.find(s => s.name === autoOpen);
    if (hit) setOpenSkill(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce drives re-runs for repeat clicks
  }, [autoOpen, autoOpenNonce, skills]);

  useEffect(() => {
    if (!autoCategory) return;
    setCategory(autoCategory);
    setFilter('');
    setSource('all');
    // Auto-expand the picked category if it was collapsed.
    setCollapsed(c => ({ ...c, [autoCategory]: false }));
  }, [autoCategory, autoCategoryNonce]);

  const filtered = useMemo(() => {
    if (!skills) return [];
    const q = filter.trim().toLowerCase();
    const list = skills.filter(s => {
      if (source !== 'all' && s.source !== source) return false;
      if (category !== 'all' && categorize(s.name) !== category) return false;
      if (usedOnly && s.invocations === 0) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === 'invocations') {
      sorted.sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name));
    } else if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    }
    return sorted;
  }, [skills, filter, source, usedOnly, sort, category]);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    if (skills) for (const s of skills) {
      const k = categorize(s.name);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [skills]);

  // For grouped view, bucket the (post-sort) filtered list into ordered categories.
  const grouped = useMemo(() => {
    const buckets = new Map<string, SkillEntry[]>();
    for (const s of filtered) {
      const k = categorize(s.name);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(s);
    }
    const ordered: { name: string; items: SkillEntry[] }[] = [];
    for (const k of CATEGORY_ORDER) {
      const items = buckets.get(k);
      if (items && items.length > 0) ordered.push({ name: k, items });
    }
    // Any unexpected categories (shouldn't happen because of 'Other' fallback) appended.
    for (const [k, items] of buckets) {
      if (!CATEGORY_ORDER.includes(k)) ordered.push({ name: k, items });
    }
    return ordered;
  }, [filtered]);

  const usedCount = skills?.filter(s => s.invocations > 0).length ?? 0;

  const overviewStats = useMemo(() => {
    if (!skills) return [];
    const byCat: Record<string, { invocations: number; count: number; used: number }> = {};
    for (const s of skills) {
      // Match the source filter so the donut reflects what the user is currently scoped to.
      if (source !== 'all' && s.source !== source) continue;
      const c = categorize(s.name);
      if (!byCat[c]) byCat[c] = { invocations: 0, count: 0, used: 0 };
      byCat[c].invocations += s.invocations;
      byCat[c].count += 1;
      if (s.invocations > 0) byCat[c].used += 1;
    }
    const order = (n: string) => {
      const i = CATEGORY_ORDER.indexOf(n);
      return i === -1 ? 9999 : i;
    };
    return Object.entries(byCat)
      .filter(([, v]) => v.invocations > 0)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.invocations - a.invocations || order(a.name) - order(b.name));
  }, [skills, source]);
  const overviewTotal = overviewStats.reduce((a, b) => a + b.invocations, 0);

  if (err) return <main className="flex-1 p-8 text-rose-400 text-sm">Failed: {err}</main>;
  if (!skills) {
    return <SkillsSkeleton />;
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
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
          title={lang === 'zh' ? '分类' : 'Category'}
        >
          <option value="all">{lang === 'zh' ? '全部分类' : 'All categories'}</option>
          {CATEGORY_ORDER.filter(k => (categoryCounts[k] ?? 0) > 0).map(k => (
            <option key={k} value={k}>
              {categoryLabel(k, lang === 'zh' ? 'zh' : 'en')} ({categoryCounts[k]})
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as typeof sort)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
          title={lang === 'zh' ? '排序' : 'Sort'}
        >
          <option value="invocations">{lang === 'zh' ? '按调用量' : 'By invocations'}</option>
          <option value="name">{lang === 'zh' ? '按名称' : 'By name'}</option>
          <option value="source">{lang === 'zh' ? '按来源' : 'By source'}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={groupByCategory} onChange={e => setGroupByCategory(e.target.checked)} />
          {lang === 'zh' ? '按分类分组' : 'Group by category'}
        </label>
        {groupByCategory && (
          <>
            <button
              type="button"
              onClick={() => setCollapsed({})}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
            >
              {lang === 'zh' ? '展开全部' : 'Expand all'}
            </button>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const g of grouped) next[g.name] = true;
                setCollapsed(next);
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
            >
              {lang === 'zh' ? '折叠全部' : 'Collapse all'}
            </button>
          </>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={usedOnly} onChange={e => setUsedOnly(e.target.checked)} />
          {lang === 'zh' ? '仅显示被调用过的' : 'Used only'}
        </label>
      </div>

      {overviewStats.length > 0 && (
        <div className="px-8 py-4 border-b border-slate-800/60">
          <CategoryDonut
            stats={overviewStats}
            total={overviewTotal}
            lang={lang}
            fmt={fmt}
            compact
            selected={category === 'all' ? null : category}
            onPick={(name: string) => setCategory(c => (c === name ? 'all' : name))}
            getLabel={(name: string) => categoryLabel(name, lang === 'zh' ? 'zh' : 'en')}
          />
        </div>
      )}

      {(() => {
        const renderRow = (s: SkillEntry) => (
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
                {!groupByCategory && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 border border-slate-700 text-slate-300">
                    {categoryLabel(categorize(s.name), lang === 'zh' ? 'zh' : 'en')}
                  </span>
                )}
                {(() => {
                  const lt = languageTagFor(s.name);
                  return lt ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-900/60 border border-slate-800 text-slate-500">
                      {lt}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const p = popularityFor(s.name);
                  if (p < 6) return null;
                  const tone = p >= 9 ? 'text-amber-300' : p >= 7 ? 'text-amber-400/80' : 'text-slate-500';
                  return (
                    <span className={`text-[11px] tabular-nums ${tone}`} title={`popularity ${p}/10`}>
                      ★{p}
                    </span>
                  );
                })()}
                {s.invocations > 0 && (
                  <span className="text-[11px] text-emerald-300 tabular-nums">
                    ×{fmt(s.invocations)}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-slate-600 font-mono truncate max-w-[420px]" title={s.path}>
                  {s.path.replace(/^.*\.(copilot|claude|agents)\//, '~/.$1/')}
                </span>
              </div>
              {(() => {
                const zh = summaryFor(s.name);
                if (lang === 'zh' && zh) {
                  return <div className="text-xs text-slate-300 mt-1 leading-relaxed">{zh}</div>;
                }
                return s.description ? (
                  <div className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {s.description}
                  </div>
                ) : null;
              })()}
            </button>
          </li>
        );

        if (filtered.length === 0) {
          return (
            <ul>
              <li className="px-8 py-12 text-center text-sm text-slate-600">
                {lang === 'zh' ? '没有匹配的技能。' : 'No skills match.'}
              </li>
            </ul>
          );
        }

        if (!groupByCategory) {
          return <ul className="divide-y divide-slate-800/60">{filtered.map(renderRow)}</ul>;
        }

        return (
          <div>
            {grouped.map(g => {
              const isCollapsed = !!collapsed[g.name];
              return (
                <section key={g.name}>
                  <button
                    type="button"
                    onClick={() => setCollapsed(c => ({ ...c, [g.name]: !c[g.name] }))}
                    className="w-full sticky top-0 z-10 px-8 py-1.5 bg-slate-950/95 backdrop-blur border-b border-t border-slate-800/60 flex items-baseline gap-2 hover:bg-slate-900/60 transition-colors text-left cursor-pointer"
                    aria-expanded={!isCollapsed}
                  >
                    <span className="text-[10px] text-slate-500 w-3 inline-block">
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                      {categoryLabel(g.name, lang === 'zh' ? 'zh' : 'en')}
                    </span>
                    <span className="text-[10px] text-slate-500 tabular-nums">{fmt(g.items.length)}</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="divide-y divide-slate-800/60">{g.items.map(renderRow)}</ul>
                  )}
                </section>
              );
            })}
          </div>
        );
      })()}
      {openSkill && (
        <SkillDrawer
          skill={openSkill}
          content={openContent}
          err={openErr}
          onClose={() => setOpenSkill(null)}
          onOpenSession={onOpenSession}
          onOpenCoSkill={(name: string) => {
            const hit = skills?.find(s => s.name === name);
            if (hit) setOpenSkill(hit);
          }}
          onPrev={(() => {
            const idx = filtered.findIndex(s => s.source === openSkill.source && s.path === openSkill.path);
            if (idx <= 0) return undefined;
            return () => setOpenSkill(filtered[idx - 1]);
          })()}
          onNext={(() => {
            const idx = filtered.findIndex(s => s.source === openSkill.source && s.path === openSkill.path);
            if (idx < 0 || idx >= filtered.length - 1) return undefined;
            return () => setOpenSkill(filtered[idx + 1]);
          })()}
          position={(() => {
            const idx = filtered.findIndex(s => s.source === openSkill.source && s.path === openSkill.path);
            return idx >= 0 ? { index: idx + 1, total: filtered.length } : null;
          })()}
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
  onOpenSession,
  onOpenCoSkill,
  onPrev,
  onNext,
  position,
}: {
  skill: SkillEntry;
  content: SkillContent | null;
  err: string | null;
  onClose: () => void;
  onOpenSession?: (id: string) => void;
  onOpenCoSkill?: (name: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number } | null;
}) {
  const { lang, fmt, rel } = useT();
  const html = useMemo(() => (content ? renderMarkdown(content.content) : ''), [content]);
  const [usage, setUsage] = useState<SkillUsage | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [usageRange, setUsageRange] = useState<'30d' | '365d'>('30d');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setUsageErr(null);
    fetchSkillUsage(skill.name)
      .then(d => !cancelled && setUsage(d))
      .catch(e => !cancelled && setUsageErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [skill.name]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(skill.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

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
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[260px]" title={skill.path}>
            {skill.path.replace(/^.*\.(copilot|claude|agents)\//, '~/.$1/')}
          </span>
          <button
            onClick={onCopy}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition-colors"
            title={lang === 'zh' ? '复制路径' : 'Copy path'}
          >
            {copied ? (lang === 'zh' ? '已复制' : 'Copied') : (lang === 'zh' ? '复制路径' : 'Copy path')}
          </button>
          <button
            onClick={async () => {
              try {
                await revealSkill(skill.path);
              } catch (e) {
                console.warn('reveal failed', e);
              }
            }}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition-colors"
            title={lang === 'zh' ? '在 Finder/资源管理器中显示' : 'Reveal in Finder/Explorer'}
          >
            {lang === 'zh' ? '打开位置' : 'Reveal'}
          </button>
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

        <div className="px-5 py-1.5 border-b border-slate-800/60 bg-slate-900/30 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            className="px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={lang === 'zh' ? '上一个 (←)' : 'Previous (←)'}
          >
            ← {lang === 'zh' ? '上一个' : 'Prev'}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={lang === 'zh' ? '下一个 (→)' : 'Next (→)'}
          >
            {lang === 'zh' ? '下一个' : 'Next'} →
          </button>
          {position && (
            <span className="ml-auto text-slate-500 tabular-nums">
              {fmt(position.index)} / {fmt(position.total)}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm">
          {/* Usage section */}
          {usage && usage.total_invocations > 0 && (
            <section className="mb-5 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <header className="flex items-baseline gap-2 mb-2">
                <h3 className="text-[11px] uppercase tracking-wider text-slate-400">
                  {usageRange === '30d'
                    ? lang === 'zh' ? '近 30 天使用情况' : '30-day usage'
                    : lang === 'zh' ? '近 365 天使用情况' : '365-day usage'}
                </h3>
                <span className="text-[10px] text-slate-500">
                  {fmt(usage.total_invocations)} {lang === 'zh' ? '次调用' : 'calls'} · {fmt(usage.session_count)} {lang === 'zh' ? '个会话' : 'sessions'}
                </span>
                <div className="ml-auto inline-flex rounded border border-slate-700 overflow-hidden text-[10px]">
                  <button
                    type="button"
                    onClick={() => setUsageRange('30d')}
                    className={`px-2 py-0.5 ${usageRange === '30d' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    30d
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsageRange('365d')}
                    className={`px-2 py-0.5 border-l border-slate-700 ${usageRange === '365d' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    365d
                  </button>
                </div>
              </header>
              {usageRange === '30d' ? (
                <UsageSpark daily={usage.daily30} />
              ) : (
                <YearHeatmap daily={usage.daily365} lang={lang} />
              )}
              {usage.sessions.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-800/60">
                  {usage.sessions.slice(0, 8).map(s => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenSession?.(s.id);
                          onClose();
                        }}
                        className="w-full text-left py-1.5 text-xs flex items-center gap-2 hover:bg-slate-800/50 rounded px-1.5 transition-colors"
                        disabled={!onOpenSession}
                      >
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase"
                          style={{
                            background: '#64748b22',
                            color: '#94a3b8',
                            border: '1px solid #64748b55',
                          }}
                        >
                          {s.agent}
                        </span>
                        <span className="text-emerald-300 tabular-nums w-10 text-right">×{s.invocations}</span>
                        <span className="text-slate-200 truncate flex-1" title={s.summary || s.id}>
                          {s.summary || s.id.slice(0, 12)}
                        </span>
                        <span className="text-slate-600 text-[10px] tabular-nums">{rel(s.last_event_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Co-occurrence section */}
          {usage && usage.cooccurring.length > 0 && (
            <section className="mb-5 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <header className="flex items-baseline gap-2 mb-2">
                <h3 className="text-[11px] uppercase tracking-wider text-slate-400">
                  {lang === 'zh' ? '常一起使用' : 'Often used with'}
                </h3>
                <span className="text-[10px] text-slate-500">
                  {lang === 'zh' ? `Top ${usage.cooccurring.length}` : `Top ${usage.cooccurring.length}`}
                </span>
              </header>
              <div className="flex flex-wrap gap-1.5">
                {usage.cooccurring.map(c => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onOpenCoSkill?.(c.name)}
                    disabled={!onOpenCoSkill}
                    className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-200 disabled:cursor-not-allowed transition-colors"
                    title={lang === 'zh' ? `共现 ${c.sessions} 个会话` : `Co-occurs in ${c.sessions} sessions`}
                  >
                    <span className="font-mono">{c.name}</span>
                    <span className="ml-1.5 text-emerald-300 tabular-nums">{c.sessions}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {usageErr && <div className="text-rose-400 text-xs mb-3">{usageErr}</div>}

          {/* Content section */}
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

function UsageSpark({ daily }: { daily: number[] }) {
  const max = Math.max(1, ...daily);
  const w = 360;
  const h = 36;
  const stepX = w / Math.max(1, daily.length - 1);
  const points = daily
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9">
      <polyline points={points} fill="none" stroke="#34d399" strokeWidth="1.4" />
      {daily.map((v, i) => {
        if (v === 0) return null;
        const x = (i * stepX).toFixed(1);
        const y = (h - (v / max) * (h - 4) - 2).toFixed(1);
        return <circle key={i} cx={x} cy={y} r={1.5} fill="#34d399" />;
      })}
    </svg>
  );
}

function YearHeatmap({ daily, lang }: { daily: number[]; lang: 'en' | 'zh' }) {
  // 365 cells laid out GitHub-style: columns = weeks, rows = day of week.
  // We anchor index `daily.length - 1` to "today" and walk backwards to fill weeks.
  const cell = 11;
  const gap = 2;
  const today = new Date();
  // dayOfWeek for today (0 = Sun)
  const todayDow = today.getDay();
  // Figure out how many leading blanks the most-recent week column needs.
  // We want the last column to have rows 0..todayDow filled.
  const trailing = 6 - todayDow; // empty cells appended after today in last column
  const totalCells = daily.length + trailing;
  const cols = Math.ceil(totalCells / 7);
  const w = cols * (cell + gap);
  const h = 7 * (cell + gap);

  // Build cells: for index i in `daily` (0 oldest .. n-1 newest), compute the
  // visual position. The last cell (i = daily.length - 1) sits at column cols-1, row todayDow.
  const max = Math.max(1, ...daily);
  const color = (v: number) => {
    if (v === 0) return 'var(--heat-empty, #1e293b)';
    const t = v / max;
    if (t < 0.2) return '#064e3b';
    if (t < 0.4) return '#047857';
    if (t < 0.7) return '#10b981';
    return '#34d399';
  };

  const cells: { x: number; y: number; v: number; date: Date }[] = [];
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (daily.length - 1));
  for (let i = 0; i < daily.length; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const offsetFromEnd = daily.length - 1 - i;
    // Walk back from (cols-1, todayDow) by offsetFromEnd days
    let col = cols - 1;
    let row = todayDow - offsetFromEnd;
    while (row < 0) {
      row += 7;
      col -= 1;
    }
    if (col < 0) continue;
    cells.push({
      x: col * (cell + gap),
      y: row * (cell + gap),
      v: daily[i],
      date,
    });
  }

  // Month labels along the top
  const monthLabels: { x: number; label: string }[] = [];
  const fmtMonth = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' });
  let lastMonth = -1;
  for (const c of cells) {
    if (c.y !== 0) continue;
    const m = c.date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ x: c.x, label: fmtMonth.format(c.date) });
      lastMonth = m;
    }
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 -14 ${w} ${h + 14}`} width={w} height={h + 14} className="block" style={{ maxWidth: '100%' }}>
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={-4}
            fill="currentColor"
            opacity={0.45}
            fontSize={9}
            fontFamily="ui-sans-serif, system-ui"
          >
            {m.label}
          </text>
        ))}
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={cell}
            height={cell}
            rx={2}
            ry={2}
            fill={color(c.v)}
          >
            <title>
              {c.date.toISOString().slice(0, 10)} · {c.v} {lang === 'zh' ? '次' : c.v === 1 ? 'call' : 'calls'}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
