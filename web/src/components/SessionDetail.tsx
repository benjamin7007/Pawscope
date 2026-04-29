import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { SessionDetailSkeleton } from './Skeleton';
import { estimateCostUsd, formatUsd, priceFor } from '../pricing';

type Meta = {
  id: string;
  agent: string;
  cwd?: string | null;
  repo?: string | null;
  branch?: string | null;
  summary?: string | null;
  model?: string | null;
  status: string;
  pid?: number | null;
  started_at?: string | null;
  last_event_at?: string | null;
};

type Detail = {
  turns: number;
  user_messages: number;
  assistant_messages: number;
  tools_used: Record<string, number>;
  skills_invoked: string[];
  subagents?: {
    id: string;
    turns: number;
    tool_calls: number;
    tools?: Record<string, number>;
    agent_type?: string | null;
    description?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    active?: boolean;
  }[];
  prompts?: { id: string; timestamp: string | null; snippet: string; text?: string }[];
  tool_calls?: { name: string; timestamp: string }[];
  tokens_in?: number;
  tokens_out?: number;
};

type Props = {
  meta: Meta | undefined;
  detail: Detail | null;
  onOpenSkill?: (name: string) => void;
  label?: { starred: boolean; tags: string[]; note?: string | null };
  onSetLabel?: (label: { starred: boolean; tags: string[]; note?: string | null }) => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
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

function formatAbs(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function duration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso || !endIso) return '';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0 || !isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-100 mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
      title="Copy"
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}

function NoteEditor({ note, onSave }: { note: string; onSave: (n: string) => void }) {
  const [draft, setDraft] = useState(note);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setDraft(note); }, [note]);
  const dirty = draft !== note;
  if (!editing && !note) {
    return (
      <div className="px-8 py-1.5 border-b border-slate-800 bg-slate-900/20">
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] text-slate-500 hover:text-slate-300"
        >+ note</button>
      </div>
    );
  }
  return (
    <div className="px-8 py-2 border-b border-slate-800 bg-slate-900/20">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">note</span>
        {editing && dirty && (
          <span className="text-[10px] text-amber-400">unsaved</span>
        )}
        <div className="ml-auto flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => { onSave(draft.trim()); setEditing(false); }}
                disabled={!dirty}
                className="text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-40"
              >save</button>
              <button
                onClick={() => { setDraft(note); setEditing(false); }}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >cancel</button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >edit</button>
              {note && (
                <button
                  onClick={() => { onSave(''); }}
                  className="text-[11px] text-rose-400/70 hover:text-rose-300"
                >clear</button>
              )}
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              onSave(draft.trim());
              setEditing(false);
            } else if (e.key === 'Escape') {
              setDraft(note);
              setEditing(false);
            }
          }}
          autoFocus
          rows={3}
          maxLength={4096}
          placeholder="Write a note about this session… (⌘+Enter to save, Esc to cancel)"
          className="w-full px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 resize-y"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="text-xs text-slate-200 whitespace-pre-wrap cursor-text leading-relaxed"
        >{note}</div>
      )}
    </div>
  );
}

function PromptRow({
  index,
  prompt,
}: {
  index: number;
  prompt: { id: string; timestamp: string | null; snippet: string; text?: string };
}) {
  const [open, setOpen] = useState(false);
  const fullText = prompt.text || prompt.snippet;
  const hasMore = (prompt.text?.length ?? 0) > prompt.snippet.length;
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex gap-3">
        <span className="text-slate-600 tabular-nums w-6 text-right flex-shrink-0">{index}</span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => hasMore && setOpen(o => !o)}
            className={`block w-full text-left text-slate-200 ${hasMore ? 'cursor-pointer hover:text-slate-100' : 'cursor-default'} ${open ? '' : 'truncate'}`}
            title={!open ? prompt.snippet : undefined}
          >
            {open ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-slate-200 text-sm leading-relaxed">
                {fullText || <span className="italic text-slate-500">(empty)</span>}
              </pre>
            ) : (
              prompt.snippet || <span className="italic text-slate-500">(empty)</span>
            )}
          </button>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[10px] text-slate-600">{prompt.id.slice(0, 8)}</span>
            {prompt.timestamp && (
              <span className="text-[10px] text-slate-500" title={formatAbs(prompt.timestamp)}>
                {timeAgo(prompt.timestamp)}
              </span>
            )}
            {hasMore && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
              >
                {open ? 'Collapse' : 'Expand'}
              </button>
            )}
            {fullText && <CopyButton text={fullText} />}
          </div>
        </div>
      </div>
    </li>
  );
}

export function SessionDetail({ meta, detail, onOpenSkill, label, onSetLabel, onPrev, onNext, position }: Props) {
  const { t, lang } = useT();
  const [availSkills, setAvailSkills] = useState<{ name: string; description: string; source: string; path: string; invoked: boolean }[] | null>(null);
  useEffect(() => {
    setAvailSkills(null);
    if (!meta?.id) return;
    let cancel = false;
    fetch(`/api/sessions/${encodeURIComponent(meta.id)}/skills`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancel && d) setAvailSkills(d.skills || []); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [meta?.id]);
  const tools = useMemo(() => {
    if (!detail?.tools_used) return [];
    return Object.entries(detail.tools_used).sort((a, b) => b[1] - a[1]);
  }, [detail]);
  const toolsTotal = tools.reduce((acc, [, v]) => acc + v, 0);
  const toolsMax = tools[0]?.[1] ?? 0;

  // Keyboard shortcuts: [ = prev, ] = next. Skip when typing in input/textarea.
  useEffect(() => {
    if (!onPrev && !onNext) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === '[' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === ']' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPrev, onNext]);

  if (!meta) {
    return (
      <main className="flex-1 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="text-5xl mb-3 opacity-30">⌖</div>
          <div className="text-sm">{t('detail.select_left')}</div>
        </div>
      </main>
    );
  }

  const isActive = meta.status === 'active';

  return (
    <main className="flex-1 overflow-y-auto">
      <header className="px-8 pt-6 pb-5 border-b border-slate-800 bg-slate-900/30">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                {t(`status.${meta.status}` as 'status.active') || meta.status}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-slate-500">{meta.agent}</span>
              {meta.pid && (
                <span className="text-[11px] text-slate-500 font-mono">pid {meta.pid}</span>
              )}
              {(onPrev || onNext) && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                  <button
                    onClick={onPrev}
                    disabled={!onPrev}
                    title="Previous session ( [ )"
                    className={`px-1.5 py-0.5 rounded ${onPrev ? 'hover:bg-slate-800 hover:text-slate-100' : 'opacity-30 cursor-not-allowed'}`}
                  >‹</button>
                  {position && (
                    <span className="text-[10px] text-slate-500 font-mono px-0.5 select-none">
                      {position.index}/{position.total}
                    </span>
                  )}
                  <button
                    onClick={onNext}
                    disabled={!onNext}
                    title="Next session ( ] )"
                    className={`px-1.5 py-0.5 rounded ${onNext ? 'hover:bg-slate-800 hover:text-slate-100' : 'opacity-30 cursor-not-allowed'}`}
                  >›</button>
                </span>
              )}
              {onSetLabel && (
                <button
                  onClick={() => onSetLabel({ starred: !(label?.starred ?? false), tags: label?.tags ?? [], note: label?.note ?? null })}
                  title={label?.starred ? 'Unstar' : 'Star'}
                  className={`ml-1 text-base leading-none ${label?.starred ? 'text-amber-300' : 'text-slate-600 hover:text-slate-400'}`}
                >
                  {label?.starred ? '★' : '☆'}
                </button>
              )}
            </div>
            <h1 className="text-2xl font-semibold text-slate-100 truncate">
              {meta.summary || <span className="text-slate-500 italic">{t('misc.no_summary')}</span>}
            </h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs font-mono text-slate-500">{meta.id}</span>
              <CopyButton text={meta.id} />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 mt-5 text-xs">
          <div>
            <dt className="text-slate-500">{t('detail.repo')}</dt>
            <dd className="text-slate-200 truncate">{meta.repo || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('detail.branch')}</dt>
            <dd className="text-slate-200 truncate">⎇ {meta.branch || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('detail.model')}</dt>
            <dd className="text-slate-200 truncate">{meta.model || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('detail.last_event')}</dt>
            <dd className="text-slate-200" title={formatAbs(meta.last_event_at)}>
              {timeAgo(meta.last_event_at)}
            </dd>
          </div>
          <div className="col-span-2 lg:col-span-4">
            <dt className="text-slate-500">{t('detail.cwd')}</dt>
            <dd className="text-slate-300 font-mono text-[11px] truncate">{meta.cwd || '—'}</dd>
          </div>
        </dl>
      </header>

      {onSetLabel && (
        <div className="px-8 py-2 border-b border-slate-800 bg-slate-900/20 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">tags</span>
          {(label?.tags ?? []).map((tg) => (
            <span key={tg} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/15 text-violet-200 text-[11px]">
              #{tg}
              <button
                onClick={() => onSetLabel({ starred: label?.starred ?? false, tags: (label?.tags ?? []).filter((x) => x !== tg), note: label?.note ?? null })}
                className="text-violet-400 hover:text-violet-100"
              >×</button>
            </span>
          ))}
          <input
            type="text"
            placeholder="+ tag"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && !(label?.tags ?? []).includes(v)) {
                  onSetLabel({ starred: label?.starred ?? false, tags: [...(label?.tags ?? []), v], note: label?.note ?? null });
                }
                (e.target as HTMLInputElement).value = '';
              }
            }}
            className="px-2 py-0.5 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600 w-20"
          />
        </div>
      )}

      {onSetLabel && (
        <NoteEditor
          note={label?.note ?? ''}
          onSave={(note) => onSetLabel({ starred: label?.starred ?? false, tags: label?.tags ?? [], note: note || null })}
        />
      )}

      {!detail ? (
        <SessionDetailSkeleton />
      ) : (
        <div className="p-6 space-y-6">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label={t('stat.turns')} value={detail.turns} />
            <StatCard label={t('stat.user_msgs')} value={detail.user_messages} hint={t('misc.inbound')} />
            <StatCard label={t('stat.assistant_msgs')} value={detail.assistant_messages} hint={t('misc.outbound')} />
            <StatCard label={t('stat.tool_calls')} value={toolsTotal} hint={`${tools.length} ${t('misc.unique')}`} />
          </section>

          {(detail.tokens_in || detail.tokens_out) ? (
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label={t('stat.tokens_in')} value={formatTokens(detail.tokens_in ?? 0)} hint={t('misc.cumulative')} />
              <StatCard label={t('stat.tokens_out')} value={formatTokens(detail.tokens_out ?? 0)} hint={t('misc.cumulative')} />
              <StatCard label={t('stat.tokens_total')} value={formatTokens((detail.tokens_in ?? 0) + (detail.tokens_out ?? 0))} />
              {(() => {
                const cost = estimateCostUsd(meta?.model, detail.tokens_in ?? 0, detail.tokens_out ?? 0);
                const pf = priceFor(meta?.model);
                if (cost === null) {
                  return <StatCard label={t('stat.cost_est')} value="—" hint={meta?.model ? t('stat.cost_unknown') : t('stat.cost_no_model')} />;
                }
                return <StatCard label={t('stat.cost_est')} value={formatUsd(cost)} hint={pf?.label ?? meta?.model ?? ''} />;
              })()}
            </section>
          ) : null}

          <ToolTimeline calls={detail.tool_calls ?? []} />

          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.tools_used')}</h3>
              <span className="text-[11px] text-slate-500">{toolsTotal} {t('misc.total')}</span>
            </header>
            {tools.length === 0 ? (
              <div className="px-4 py-6 text-xs text-slate-600 text-center">{t('detail.no_tools')}</div>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {tools.map(([name, count]) => {
                  const pct = toolsMax > 0 ? (count / toolsMax) * 100 : 0;
                  return (
                    <li key={name} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="font-mono text-slate-200 w-32 truncate">{name}</span>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500/70 to-emerald-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-slate-400 tabular-nums w-12 text-right">×{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.skills_invoked')}</h3>
              <span className="text-[11px] text-slate-500">{detail.skills_invoked.length}</span>
            </header>
            <div className="p-4">
              {detail.skills_invoked.length === 0 ? (
                <div className="text-xs text-slate-600 text-center py-2">{t('detail.no_skills')}</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(
                    detail.skills_invoked.reduce<Record<string, number>>((acc, n) => {
                      acc[n] = (acc[n] ?? 0) + 1;
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .map(([name, count]) => {
                      const inner = (
                        <>
                          <span className="font-mono">{name}</span>
                          {count > 1 && (
                            <span className="ml-1.5 text-emerald-300 tabular-nums">×{count}</span>
                          )}
                        </>
                      );
                      return onOpenSkill ? (
                        <button
                          key={name}
                          type="button"
                          onClick={() => onOpenSkill(name)}
                          className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-200 transition-colors cursor-pointer"
                          title={lang === 'zh' ? '打开技能' : 'Open skill'}
                        >
                          {inner}
                        </button>
                      ) : (
                        <span
                          key={name}
                          className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200"
                        >
                          {inner}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg bg-slate-900/40 border border-slate-800">
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.skills_available')}</h3>
              <span className="text-[11px] text-slate-500">
                {availSkills === null ? '…' : availSkills.length}
              </span>
            </header>
            <div className="p-4">
              {availSkills === null ? (
                <div className="text-xs text-slate-600 text-center py-2">…</div>
              ) : availSkills.length === 0 ? (
                <div className="text-xs text-slate-600 text-center py-2">{t('detail.no_skills')}</div>
              ) : (
                <details>
                  <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300 mb-2 select-none">
                    {lang === 'zh'
                      ? `展开 ${availSkills.length} 个可用技能（${availSkills.filter(s => s.invoked).length} 已使用）`
                      : `Show ${availSkills.length} available skills (${availSkills.filter(s => s.invoked).length} used)`}
                  </summary>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {availSkills.map(s => {
                      const cls = s.invoked
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200';
                      const title = `${s.source}\n${s.path}\n\n${s.description}`;
                      return onOpenSkill ? (
                        <button
                          key={s.path}
                          type="button"
                          onClick={() => onOpenSkill(s.name)}
                          className={`px-2 py-0.5 rounded-full border text-[11px] font-mono transition-colors ${cls}`}
                          title={title}
                        >
                          {s.name}
                        </button>
                      ) : (
                        <span
                          key={s.path}
                          className={`px-2 py-0.5 rounded-full border text-[11px] font-mono ${cls}`}
                          title={title}
                        >
                          {s.name}
                        </span>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </section>

          {detail.subagents && detail.subagents.length > 0 && (
            <section className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('detail.subagents')}</h3>
                <span className="text-[11px] text-slate-500">{detail.subagents.length}</span>
              </header>
              <ul className="divide-y divide-slate-800/60">
                {detail.subagents.map(sa => {
                  const toolEntries = Object.entries(sa.tools || {}).sort((a, b) => b[1] - a[1]);
                  const maxTool = toolEntries[0]?.[1] ?? 1;
                  const hasTools = toolEntries.length > 0;
                  const dur = duration(sa.started_at, sa.ended_at);
                  return (
                    <li key={sa.id}>
                      <details className="group">
                        <summary
                          className={`px-4 py-2.5 flex items-center gap-3 text-sm list-none ${hasTools ? 'cursor-pointer hover:bg-slate-800/30' : ''}`}
                        >
                          <span
                            className={`text-slate-600 text-xs w-3 transition-transform ${hasTools ? 'group-open:rotate-90' : 'opacity-30'}`}
                          >▶</span>
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${sa.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
                            title={sa.active ? t('status.active') : t('status.idle')}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {sa.agent_type && (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-medium text-indigo-300 flex-shrink-0">
                                  {sa.agent_type}
                                </span>
                              )}
                              <span className="text-slate-200 truncate" title={sa.description || sa.id}>
                                {sa.description || <span className="font-mono text-[11px] text-slate-400">{sa.id}</span>}
                              </span>
                            </div>
                            {sa.description && (
                              <div className="font-mono text-[10px] text-slate-600 mt-0.5">{sa.id}</div>
                            )}
                          </div>
                          <span className="text-slate-400 tabular-nums text-xs flex-shrink-0">
                            <span className="text-slate-500">{t('misc.turns_suffix')}</span> {sa.turns}
                          </span>
                          <span className="text-slate-400 tabular-nums text-xs flex-shrink-0">
                            <span className="text-slate-500">tools</span> {sa.tool_calls}
                          </span>
                          {dur && (
                            <span
                              className="text-slate-400 tabular-nums text-xs flex-shrink-0"
                              title={`${formatAbs(sa.started_at)} → ${formatAbs(sa.ended_at)}`}
                            >
                              <span className="text-slate-500">⏱</span> {dur}
                            </span>
                          )}
                        </summary>
                        {hasTools && (
                          <div className="px-4 pt-1 pb-3 space-y-1 bg-slate-900/30">
                            {toolEntries.map(([name, count]) => (
                              <div key={name} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-slate-400 w-28 truncate" title={name}>{name}</span>
                                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500/70"
                                    style={{ width: `${(count / maxTool) * 100}%` }}
                                  />
                                </div>
                                <span className="tabular-nums text-slate-300 w-10 text-right">{count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {detail.prompts && detail.prompts.length > 0 && (
            <section className="rounded-lg bg-slate-900/40 border border-slate-800">
              <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.prompts')}</h3>
                <span className="text-[11px] text-slate-500">{detail.prompts.length}</span>
              </header>
              <ol className="divide-y divide-slate-800/60">
                {detail.prompts.map((p, i) => (
                  <PromptRow key={p.id} index={i + 1} prompt={p} />
                ))}
              </ol>
            </section>
          )}

          <section className="text-[11px] text-slate-600 px-1">
            Started {formatAbs(meta.started_at)} · Last event {formatAbs(meta.last_event_at)}
          </section>
        </div>
      )}
    </main>
  );
}

const TIMELINE_COLORS = [
  '#22d3ee', '#34d399', '#a78bfa', '#fbbf24', '#fb7185',
  '#fb923c', '#60a5fa', '#f472b6', '#4ade80', '#facc15',
];

function ToolTimeline({ calls }: { calls: { name: string; timestamp: string }[] }) {
  const { t, lang } = useT();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  if (!calls || calls.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/40 border border-slate-800">
        <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.tool_timeline')}</h3>
          <span className="text-[11px] text-slate-500">0</span>
        </header>
        <div className="px-4 py-6 text-xs text-slate-600 text-center">{t('timeline.empty')}</div>
      </section>
    );
  }
  const times = calls.map(c => new Date(c.timestamp).getTime()).filter(n => Number.isFinite(n));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, 1);
  const colorMap = new Map<string, string>();
  const countByName = new Map<string, number>();
  for (const c of calls) {
    countByName.set(c.name, (countByName.get(c.name) ?? 0) + 1);
    if (!colorMap.has(c.name)) {
      colorMap.set(c.name, TIMELINE_COLORS[colorMap.size % TIMELINE_COLORS.length]);
    }
  }
  // Sort legend by call frequency desc
  const sortedNames = Array.from(countByName.entries()).sort((a, b) => b[1] - a[1]);
  const totalMin = (max - min) / 60000;
  const durationLabel =
    totalMin < 1 ? `${Math.round((max - min) / 1000)}s` :
    totalMin < 60 ? `${Math.round(totalMin)}m` :
    `${(totalMin / 60).toFixed(1)}h`;

  // Density bins for high-volume sessions
  const N_BINS = 60;
  const filtered = activeFilter ? calls.filter(c => c.name === activeFilter) : calls;
  const bins = new Array(N_BINS).fill(0) as number[];
  for (const c of filtered) {
    const tt = new Date(c.timestamp).getTime();
    const idx = Math.min(N_BINS - 1, Math.floor(((tt - min) / span) * N_BINS));
    bins[idx]++;
  }
  const binMax = Math.max(1, ...bins);
  const showDots = filtered.length <= 200;

  const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="rounded-lg bg-slate-900/40 border border-slate-800">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-slate-400">{t('sec.tool_timeline')}</h3>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {activeFilter ? `${filtered.length} / ${calls.length}` : calls.length} · {durationLabel}
          {activeFilter && (
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              className="ml-2 px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >×</button>
          )}
        </span>
      </header>
      <div className="p-4">
        {/* Density histogram */}
        <div className="relative h-12 flex items-end gap-px bg-slate-950/60 rounded border border-slate-800/80 px-1 pb-1">
          {bins.map((v, i) => {
            const h = (v / binMax) * 100;
            return (
              <div
                key={i}
                className="flex-1 bg-emerald-500/60 hover:bg-emerald-400 transition-colors rounded-sm"
                style={{ height: `${h}%`, minHeight: v > 0 ? '2px' : '0' }}
                title={`${fmtTime(min + (i / N_BINS) * span)} — ${fmtTime(min + ((i + 1) / N_BINS) * span)}: ${v}`}
              />
            );
          })}
        </div>
        {/* Dot strip — only when ≤200 calls (avoids visual mush) */}
        {showDots && (
          <div className="relative h-6 mt-2 bg-slate-950/40 rounded border border-slate-800/60">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-px bg-slate-800/80" />
            {filtered.map((c, i) => {
              const tt = new Date(c.timestamp).getTime();
              const pct = ((tt - min) / span) * 100;
              const color = colorMap.get(c.name) ?? '#94a3b8';
              return (
                <div
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full transition-transform hover:scale-150"
                  style={{ left: `${pct}%`, background: color, boxShadow: `0 0 0 1.5px rgba(15,23,42,1)` }}
                  title={`${c.name} · ${new Date(c.timestamp).toLocaleString()}`}
                />
              );
            })}
          </div>
        )}
        {/* Time axis labels */}
        <div className="mt-1 flex justify-between text-[10px] text-slate-500 tabular-nums">
          <span>{fmtTime(min)}</span>
          <span>{fmtTime(min + span / 2)}</span>
          <span>{fmtTime(max)}</span>
        </div>
        {/* Clickable legend (sorted by frequency) */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sortedNames.slice(0, 16).map(([name, n]) => {
            const color = colorMap.get(name) ?? '#94a3b8';
            const isActive = activeFilter === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setActiveFilter(isActive ? null : name)}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                  isActive
                    ? 'bg-slate-800 border-slate-600 text-slate-100'
                    : 'border-transparent hover:bg-slate-800/60 text-slate-300'
                }`}
                title={lang === 'zh' ? '点击仅看这个工具' : 'Click to filter to this tool'}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="font-mono">{name}</span>
                <span className="text-slate-500 tabular-nums">×{n}</span>
              </button>
            );
          })}
          {sortedNames.length > 16 && (
            <span className="text-[11px] text-slate-500 self-center">+{sortedNames.length - 16}</span>
          )}
        </div>
      </div>
    </section>
  );
}
