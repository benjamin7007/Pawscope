import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';

type Session = { id: string; agent: string; summary?: string | null; repo?: string | null; cwd?: string | null; status: string };
type PromptHit = { session_id: string; agent: string; cwd?: string | null; snippet: string; timestamp?: string | null; prompt_id: string };
type SkillEntry = { name: string; description: string };

type Result =
  | { kind: 'session'; id: string; label: string; sub: string }
  | { kind: 'prompt'; session_id: string; label: string; sub: string }
  | { kind: 'skill'; name: string; label: string; sub: string };

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  onOpenSession: (id: string) => void;
  onOpenSkill: (name: string) => void;
  initialQuery?: string;
}

export function CommandPalette({ open, onClose, sessions, onOpenSession, onOpenSkill, initialQuery }: Props) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [prompts, setPrompts] = useState<PromptHit[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ(initialQuery ?? '');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, initialQuery]);

  // Fetch skills once
  useEffect(() => {
    if (!open || skills.length) return;
    fetch('/api/skills')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.skills) setSkills(d.skills.map((s: any) => ({ name: s.name, description: s.description }))); })
      .catch(() => {});
  }, [open, skills.length]);

  // Debounced prompt search
  useEffect(() => {
    if (!open) return;
    const tid = setTimeout(() => {
      const url = q.trim()
        ? `/api/prompts/search?q=${encodeURIComponent(q)}&limit=20`
        : '/api/prompts/search?q=&limit=20';
      fetch(url).then(r => r.ok ? r.json() : null).then(d => {
        if (d) setPrompts(d.results || d || []);
      }).catch(() => {});
    }, 150);
    return () => clearTimeout(tid);
  }, [q, open]);

  const results = useMemo<Result[]>(() => {
    const ql = q.trim().toLowerCase();
    const out: Result[] = [];
    // Sessions
    const sessHits = sessions.filter(s => {
      if (!ql) return true;
      return (
        s.id.toLowerCase().includes(ql) ||
        (s.summary || '').toLowerCase().includes(ql) ||
        (s.repo || '').toLowerCase().includes(ql) ||
        (s.cwd || '').toLowerCase().includes(ql) ||
        s.agent.toLowerCase().includes(ql)
      );
    }).slice(0, 8);
    for (const s of sessHits) {
      out.push({
        kind: 'session',
        id: s.id,
        label: s.summary || s.id.slice(0, 8),
        sub: `${s.agent}${s.repo ? ` · ${s.repo}` : ''}${s.status === 'active' ? ' · ●' : ''}`,
      });
    }
    // Skills
    const skillHits = skills.filter(s => {
      if (!ql) return true;
      return s.name.toLowerCase().includes(ql) || (s.description || '').toLowerCase().includes(ql);
    }).slice(0, 6);
    for (const s of skillHits) {
      out.push({
        kind: 'skill',
        name: s.name,
        label: s.name,
        sub: (s.description || '').slice(0, 80),
      });
    }
    // Prompts (already filtered server-side)
    for (const p of prompts.slice(0, 8)) {
      out.push({
        kind: 'prompt',
        session_id: p.session_id,
        label: p.snippet.slice(0, 90),
        sub: `${p.agent}${p.cwd ? ` · ${p.cwd.split('/').pop()}` : ''}`,
      });
    }
    return out;
  }, [q, sessions, skills, prompts]);

  // Clamp active index
  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1));
  }, [results.length, active]);

  // Scroll active into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (r: Result) => {
    onClose();
    if (r.kind === 'session') onOpenSession(r.id);
    else if (r.kind === 'prompt') onOpenSession(r.session_id);
    else if (r.kind === 'skill') onOpenSkill(r.name);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          placeholder={lang === 'zh' ? '搜索会话 / 提示 / 技能…' : 'Search sessions / prompts / skills…'}
          className="w-full px-4 py-3 bg-slate-900 border-b border-slate-800 text-slate-100 outline-none placeholder:text-slate-500"
        />
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {lang === 'zh' ? '无结果' : 'No results'}
            </div>
          ) : (
            results.map((r, i) => {
              const icon = r.kind === 'session' ? '📂' : r.kind === 'prompt' ? '💬' : '🧩';
              const tag = r.kind === 'session' ? t('nav.session') : r.kind === 'prompt' ? (lang === 'zh' ? '提示' : 'Prompt') : (lang === 'zh' ? '技能' : 'Skill');
              const tagColor = r.kind === 'session' ? 'text-cyan-300' : r.kind === 'prompt' ? 'text-amber-300' : 'text-emerald-300';
              return (
                <button
                  key={i}
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                  className={`w-full text-left px-4 py-2.5 flex items-start gap-3 border-l-2 ${i === active ? 'bg-slate-800/80 border-cyan-400' : 'border-transparent hover:bg-slate-800/40'}`}
                >
                  <span className="text-base leading-tight pt-0.5">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase font-semibold ${tagColor}`}>{tag}</span>
                      <span className="text-sm text-slate-100 truncate">{r.label}</span>
                    </div>
                    {r.sub && <div className="text-xs text-slate-500 truncate">{r.sub}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-500">
          <span><kbd className="px-1 rounded bg-slate-800">↑↓</kbd> {lang === 'zh' ? '导航' : 'navigate'}</span>
          <span><kbd className="px-1 rounded bg-slate-800">↵</kbd> {lang === 'zh' ? '打开' : 'open'}</span>
          <span><kbd className="px-1 rounded bg-slate-800">Esc</kbd> {lang === 'zh' ? '关闭' : 'close'}</span>
          <span className="ml-auto">{results.length} {lang === 'zh' ? '条' : 'results'}</span>
        </div>
      </div>
    </div>
  );
}
