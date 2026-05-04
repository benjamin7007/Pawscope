import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { SessionDetailSkeleton } from './Skeleton';
import { estimateCostUsd, formatUsd, priceFor } from '../pricing';
import { ConversationFlow } from './ConversationFlow';
import { fetchSessionInstructions, type SessionInstructions } from '../api';
import { renderMarkdown } from '../markdown';

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

type ReplayEvent = {
  kind: 'prompt' | 'tool';
  timestamp: string;
  label: string;
  full: string;
};

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function srtTime(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(3, '0')}`;
}

function exportSrt(events: ReplayEvent[]): string {
  if (events.length === 0) return '';
  const t0 = new Date(events[0].timestamp).getTime();
  const lines: string[] = [];
  events.forEach((ev, i) => {
    const start = new Date(ev.timestamp).getTime() - t0;
    const next = events[i + 1] ? new Date(events[i + 1].timestamp).getTime() - t0 : start + 4000;
    const end = Math.max(start + 1500, next - 200);
    const tag = ev.kind === 'prompt' ? '💬' : '🔧';
    const body = (ev.full || ev.label).replace(/\r?\n/g, ' ').slice(0, 240);
    lines.push(`${i + 1}`);
    lines.push(`${srtTime(start)} --> ${srtTime(end)}`);
    lines.push(`${tag} ${body}`);
    lines.push('');
  });
  return lines.join('\n');
}

function exportMarkdown(events: ReplayEvent[], sessionId: string): string {
  if (events.length === 0) return '';
  const t0 = new Date(events[0].timestamp).getTime();
  const lines: string[] = [
    `# Session replay — ${sessionId}`,
    '',
    `_Generated ${new Date().toISOString()} · ${events.length} events_`,
    '',
    '---',
    '',
  ];
  events.forEach((ev, i) => {
    const elapsed = new Date(ev.timestamp).getTime() - t0;
    const tag = ev.kind === 'prompt' ? '💬 **Prompt**' : '🔧 `tool`';
    lines.push(`## #${i + 1} · +${(elapsed / 1000).toFixed(1)}s · ${tag}`);
    lines.push('');
    lines.push(`_${new Date(ev.timestamp).toLocaleString()}_`);
    lines.push('');
    if (ev.kind === 'prompt') {
      lines.push('> ' + (ev.full || ev.label).replace(/\n/g, '\n> '));
    } else {
      lines.push('`' + ev.label + '`');
    }
    lines.push('');
  });
  return lines.join('\n');
}

function exportJson(events: ReplayEvent[], sessionId: string): string {
  if (events.length === 0) return '';
  const t0 = new Date(events[0].timestamp).getTime();
  return JSON.stringify(
    {
      session_id: sessionId,
      generated_at: new Date().toISOString(),
      total_events: events.length,
      events: events.map((ev, i) => ({
        idx: i,
        kind: ev.kind,
        timestamp: ev.timestamp,
        elapsed_ms: new Date(ev.timestamp).getTime() - t0,
        label: ev.label,
        full: ev.full,
      })),
    },
    null,
    2,
  );
}

function exportSessionJson(meta: any, detail: any): string {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    meta,
    detail,
  }, null, 2);
}

function exportSessionMarkdown(meta: any, detail: any): string {
  const lines: string[] = [];
  lines.push(`# ${meta.summary || meta.id}`);
  lines.push('');
  lines.push(`- **Session**: \`${meta.id}\``);
  lines.push(`- **Agent**: ${meta.agent}`);
  if (meta.model) lines.push(`- **Model**: ${meta.model}`);
  if (meta.repo) lines.push(`- **Repo**: ${meta.repo}`);
  if (meta.branch) lines.push(`- **Branch**: ${meta.branch}`);
  if (meta.cwd) lines.push(`- **CWD**: \`${meta.cwd}\``);
  lines.push(`- **Status**: ${meta.status}`);
  lines.push(`- **Last event**: ${meta.last_event_at}`);
  lines.push('');
  if (detail?.prompts?.length) {
    lines.push(`## Prompts (${detail.prompts.length})`);
    lines.push('');
    detail.prompts.forEach((p: any, i: number) => {
      const ts = p.timestamp ? ` _(${p.timestamp})_` : '';
      lines.push(`### ${i + 1}.${ts}`);
      lines.push('');
      lines.push('> ' + (p.text || p.snippet || '').split(/\r?\n/).join('\n> '));
      lines.push('');
    });
  }
  if (detail?.tool_calls?.length) {
    lines.push(`## Tool calls (${detail.tool_calls.length})`);
    lines.push('');
    detail.tool_calls.forEach((c: any) => {
      lines.push(`- \`${c.name}\` — ${c.timestamp || ''}`);
    });
    lines.push('');
  }
  if (detail?.tools_used && Object.keys(detail.tools_used).length) {
    lines.push(`## Tool histogram`);
    lines.push('');
    lines.push('| Tool | Count |');
    lines.push('|------|------:|');
    Object.entries(detail.tools_used).sort((a: any, b: any) => b[1] - a[1])
      .forEach(([n, c]) => lines.push(`| \`${n}\` | ${c} |`));
    lines.push('');
  }
  return lines.join('\n');
}

function SessionExportMenu({ meta, detail, t }: { meta: any; detail: any; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const baseName = `session-${String(meta.id || '').slice(0, 12)}`;
  const items: { label: string; ext: string; mime: string; build: () => string }[] = [
    { label: '📝 Markdown', ext: 'md', mime: 'text/markdown', build: () => exportSessionMarkdown(meta, detail) },
    { label: '🔢 JSON', ext: 'json', mime: 'application/json', build: () => exportSessionJson(meta, detail) },
  ];
  // Cmd+E / Ctrl+E exports the open session as Markdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
        // Skip if user is typing into an input/textarea/contenteditable.
        const tgt = e.target as HTMLElement | null;
        if (tgt) {
          const tag = tgt.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt.isContentEditable) return;
        }
        e.preventDefault();
        const md = exportSessionMarkdown(meta, detail);
        if (md) downloadFile(`${baseName}.md`, md, 'text/markdown');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta, detail, baseName]);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
        title={t('misc.export_session')}
      >⤓ {t('misc.export_session')}</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 rounded-md bg-slate-900 border border-slate-700 shadow-lg overflow-hidden text-xs min-w-[160px]">
          {items.map(it => (
            <button
              key={it.ext}
              type="button"
              onClick={() => {
                const data = it.build();
                if (!data) return;
                downloadFile(`${baseName}.${it.ext}`, data, it.mime);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-800 text-slate-200"
            >{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ events, sessionId, t }: { events: ReplayEvent[]; sessionId: string; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const baseName = `replay-${(sessionId || 'session').slice(0, 12)}`;
  const items: { label: string; ext: string; mime: string; build: () => string }[] = [
    { label: '📺 SRT subtitles', ext: 'srt', mime: 'application/x-subrip', build: () => exportSrt(events) },
    { label: '📝 Markdown screenplay', ext: 'md', mime: 'text/markdown', build: () => exportMarkdown(events, sessionId) },
    { label: '🔢 JSON', ext: 'json', mime: 'application/json', build: () => exportJson(events, sessionId) },
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
        title={t('misc.export')}
      >⤓ {t('misc.export')}</button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 w-56 rounded border border-slate-700 bg-slate-900 shadow-lg overflow-hidden">
          {items.map(it => (
            <button
              key={it.ext}
              onClick={() => {
                downloadFile(`${baseName}.${it.ext}`, it.build(), it.mime);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function HeatBar({ events, bins = 60 }: { events: ReplayEvent[]; bins?: number }) {
  if (events.length < 2) return null;
  const t0 = new Date(events[0].timestamp).getTime();
  const tEnd = new Date(events[events.length - 1].timestamp).getTime();
  const span = Math.max(1, tEnd - t0);
  const counts = new Array(bins).fill(0).map(() => ({ p: 0, t: 0 }));
  for (const ev of events) {
    const off = new Date(ev.timestamp).getTime() - t0;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((off / span) * bins)));
    if (ev.kind === 'prompt') counts[i].p++; else counts[i].t++;
  }
  const max = Math.max(1, ...counts.map(c => c.p + c.t));
  return (
    <div className="flex items-stretch gap-px h-3 w-40" title="Session pulse — darker = busier">
      {counts.map((c, i) => {
        const total = c.p + c.t;
        if (total === 0) {
          return <div key={i} className="flex-1 bg-slate-800/40 rounded-sm" />;
        }
        const intensity = total / max;
        const promptDom = c.p >= c.t;
        const hue = promptDom ? '34, 211, 238' : '52, 211, 153';
        return (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{ background: `rgba(${hue}, ${0.25 + intensity * 0.75})` }}
          />
        );
      })}
    </div>
  );
}

function ReplaySection({
  prompts,
  tools,
  sessionId,
  t,
}: {
  prompts: ReplayEvent[];
  tools: ReplayEvent[];
  sessionId: string;
  t: (k: string) => string;
}) {
  const events = useMemo(() => {
    const all = [...prompts, ...tools];
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return all;
  }, [prompts, tools]);
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const active = open || fullscreen;
    if (!playing || !active) return;
    if (idx >= events.length - 1) { setPlaying(false); return; }
    const baseMs = 800 / speed;
    const id = setTimeout(() => setIdx((v) => Math.min(events.length - 1, v + 1)), baseMs);
    return () => clearTimeout(id);
  }, [playing, idx, events.length, speed, open, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
      else if (e.key === ' ') { e.preventDefault(); setPlaying((v) => !v); }
      else if (e.key === 'ArrowRight') setIdx((v) => Math.min(events.length - 1, v + 1));
      else if (e.key === 'ArrowLeft') setIdx((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, events.length]);

  if (events.length === 0) return null;
  const tStart = new Date(events[0].timestamp).getTime();
  const tEnd = new Date(events[events.length - 1].timestamp).getTime();
  const totalMs = Math.max(1, tEnd - tStart);
  const current = events[idx];
  const elapsed = new Date(current.timestamp).getTime() - tStart;
  const visible = events.slice(0, idx + 1);

  const controls = (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => setPlaying((v) => !v)}
        className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
      >
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <button
        onClick={() => { setIdx(0); setPlaying(false); }}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
      >⏮</button>
      <button
        onClick={() => setIdx((v) => Math.max(0, v - 1))}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
      >◀</button>
      <button
        onClick={() => setIdx((v) => Math.min(events.length - 1, v + 1))}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
      >▶</button>
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 text-xs"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
        <option value={8}>8×</option>
      </select>
      <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
        {idx + 1} / {events.length} · +{(elapsed / 1000).toFixed(0)}s
      </span>
      <button
        onClick={() => setFullscreen((v) => !v)}
        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >{fullscreen ? '⤓' : '⛶'}</button>
      <ExportMenu events={events} sessionId={sessionId} t={t} />
    </div>
  );

  const slider = (
    <>
      <input
        type="range"
        min={0}
        max={events.length - 1}
        value={idx}
        onChange={(e) => { setIdx(Number(e.target.value)); setPlaying(false); }}
        className="w-full accent-cyan-400"
      />
      <div className="relative h-1 bg-slate-800 rounded">
        <div
          className="absolute inset-y-0 left-0 bg-cyan-500/40 rounded"
          style={{ width: `${(elapsed / totalMs) * 100}%` }}
        />
        {events.map((ev, i) => {
          const offset = ((new Date(ev.timestamp).getTime() - tStart) / totalMs) * 100;
          const isPrompt = ev.kind === 'prompt';
          return (
            <div
              key={i}
              className={`absolute top-1/2 -translate-y-1/2 w-1 h-3 rounded-sm ${
                isPrompt ? 'bg-cyan-400' : 'bg-emerald-400'
              } ${i === idx ? 'ring-2 ring-white' : ''} ${i <= idx ? '' : 'opacity-30'}`}
              style={{ left: `${offset}%` }}
              title={`${ev.kind}: ${ev.label}`}
            />
          );
        })}
      </div>
    </>
  );

  const isCurrentPrompt = current.kind === 'prompt';
  const preview = (
    <div className={`rounded border ${
      isCurrentPrompt
        ? 'border-cyan-500/40 bg-cyan-500/5'
        : 'border-emerald-500/40 bg-emerald-500/5'
    } p-3 ${fullscreen ? 'min-h-[180px]' : 'max-h-44'} overflow-auto`}>
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        <span className={`font-semibold uppercase tracking-wider ${
          isCurrentPrompt ? 'text-cyan-300' : 'text-emerald-300'
        }`}>
          {isCurrentPrompt ? '💬 prompt' : '🔧 tool call'}
        </span>
        <span className="text-slate-500 tabular-nums">+{(elapsed / 1000).toFixed(1)}s</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-500">{new Date(current.timestamp).toLocaleString()}</span>
      </div>
      <div className={`${
        isCurrentPrompt ? 'text-slate-100 whitespace-pre-wrap break-words' : 'text-slate-200 font-mono'
      } ${fullscreen ? 'text-sm leading-relaxed' : 'text-xs'}`}>
        {current.full || current.label}
      </div>
    </div>
  );

  const eventList = (
    <div className={`overflow-auto rounded bg-slate-950/60 border border-slate-800 p-2 space-y-1.5 ${
      fullscreen ? 'flex-1 min-h-0' : 'max-h-72'
    }`}>
      {visible.map((ev, i) => {
        const isCurrent = i === idx;
        const isPrompt = ev.kind === 'prompt';
        return (
          <button
            key={i}
            onClick={() => { setIdx(i); setPlaying(false); }}
            className={`w-full text-left text-xs px-2 py-1.5 rounded border-l-2 transition-all ${
              isPrompt
                ? 'border-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10'
                : 'border-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10'
            } ${isCurrent ? 'ring-1 ring-slate-600' : 'opacity-70 hover:opacity-100'}`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[10px] font-semibold uppercase ${isPrompt ? 'text-cyan-400' : 'text-emerald-400'}`}>
                {isPrompt ? '💬 prompt' : '🔧 tool'}
              </span>
              <span className="text-[10px] text-slate-500 tabular-nums">
                +{((new Date(ev.timestamp).getTime() - tStart) / 1000).toFixed(0)}s
              </span>
            </div>
            <div className={`${isPrompt ? 'text-slate-200' : 'text-slate-300 font-mono'} truncate`}>
              {ev.label}
            </div>
          </button>
        );
      })}
    </div>
  );

  const inline = open && !fullscreen && (
    <div className="px-4 py-3 space-y-3">
      {controls}
      {slider}
      {preview}
      {eventList}
    </div>
  );

  const fullscreenOverlay = fullscreen && (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col">
      <header className="px-6 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-slate-300">▶ {t('sec.replay')} · {t('misc.fullscreen')}</h2>
        <button
          onClick={() => setFullscreen(false)}
          className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
        >Esc · {t('misc.collapse')}</button>
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 p-6">
        <div className="flex flex-col gap-3 min-h-0">
          {controls}
          {slider}
          <div className="flex-1 min-h-0 overflow-auto">
            {preview}
          </div>
        </div>
        <div className="flex flex-col gap-2 min-h-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">events</div>
          {eventList}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <section className="rounded-lg bg-slate-900/40 border border-slate-800">
        <header className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-xs uppercase tracking-wider text-slate-400 whitespace-nowrap">▶ {t('sec.replay')}</h3>
            <HeatBar events={events} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setFullscreen(true); setIdx(0); setPlaying(false); }}
              className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              title={t('misc.fullscreen')}
            >⛶ {t('misc.fullscreen')}</button>
            <button
              onClick={() => { setOpen((v) => !v); if (!open) { setIdx(0); setPlaying(false); } }}
              className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              {open ? t('misc.collapse') : `${t('misc.open_replay')} (${events.length})`}
            </button>
          </div>
        </header>
        {inline}
      </section>
      {fullscreenOverlay}
    </>
  );
}

export function SessionDetail({ meta, detail, onOpenSkill, label, onSetLabel, onPrev, onNext, position }: Props) {
  const { t, lang } = useT();
  const [tab, setTab] = useState<'summary' | 'conversation' | 'context'>('summary');
  const [availSkills, setAvailSkills] = useState<{ name: string; description: string; source: string; path: string; invoked: boolean }[] | null>(null);
  const [instructions, setInstructions] = useState<SessionInstructions | null>(null);
  const [systemPrompts, setSystemPrompts] = useState<{ at: string; content: string }[]>([]);
  const [sessionContext, setSessionContext] = useState<{
    plan: string | null;
    checkpoints: { filename: string; title: string; content: string; sections: {
      overview?: string; history?: string; work_done?: string;
      technical_details?: string; important_files?: string; next_steps?: string;
    } }[];
    todos: { id: string; title: string; description: string; status: string }[];
    has_context: boolean;
  } | null>(null);
  useEffect(() => {
    setAvailSkills(null);
    setInstructions(null);
    setSystemPrompts([]);
    setSessionContext(null);
    setTab('summary');
    if (!meta?.id) return;
    let cancel = false;
    fetch(`/api/sessions/${encodeURIComponent(meta.id)}/skills`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancel && d) setAvailSkills(d.skills || []); })
      .catch(() => {});
    fetchSessionInstructions(meta.id)
      .then(d => { if (!cancel) setInstructions(d); })
      .catch(() => {});
    fetch(`/api/sessions/${encodeURIComponent(meta.id)}/conversation`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancel && d?.system_prompts?.length) setSystemPrompts(d.system_prompts); })
      .catch(() => {});
    fetch(`/api/sessions/${encodeURIComponent(meta.id)}/context`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancel && d) setSessionContext(d); })
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
              <span className="ml-2"><SessionExportMenu meta={meta} detail={detail} t={t} /></span>
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
        <>
          <nav className="px-8 pt-4 border-b border-slate-800 bg-slate-900/30 flex items-center gap-1">
            <button
              onClick={() => setTab('summary')}
              className={`px-3 py-1.5 text-[12px] rounded-t border-b-2 transition-colors ${
                tab === 'summary'
                  ? 'text-cyan-300 border-cyan-400 bg-slate-900/60'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {t('tab.summary')}
            </button>
            <button
              onClick={() => setTab('conversation')}
              className={`px-3 py-1.5 text-[12px] rounded-t border-b-2 transition-colors ${
                tab === 'conversation'
                  ? 'text-cyan-300 border-cyan-400 bg-slate-900/60'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {t('tab.conversation')}
            </button>
            {sessionContext?.has_context && (
              <button
                onClick={() => setTab('context')}
                className={`px-3 py-1.5 text-[12px] rounded-t border-b-2 transition-colors ${
                  tab === 'context'
                    ? 'text-cyan-300 border-cyan-400 bg-slate-900/60'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                {t('tab.context')}
              </button>
            )}
          </nav>

          {tab === 'conversation' ? (
            <ConversationFlow sessionId={meta.id} />
          ) : tab === 'context' && sessionContext ? (
            <div className="p-6 space-y-6 overflow-y-auto">
              {sessionContext.plan && (
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                  <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                    <span className="text-lg">📋</span>
                    <h3 className="text-sm font-semibold text-slate-200">{t('ctx.plan')}</h3>
                  </header>
                  <div
                    className="p-4 text-[12px] text-slate-300 leading-relaxed max-h-[500px] overflow-y-auto prose-sm"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(sessionContext.plan) }}
                  />
                </section>
              )}

              {sessionContext.todos.length > 0 && (
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                  <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                    <span className="text-lg">✅</span>
                    <h3 className="text-sm font-semibold text-slate-200">{t('ctx.todos')}</h3>
                    <span className="text-[11px] text-slate-500 ml-auto">
                      {sessionContext.todos.filter(td => td.status === 'done').length}/{sessionContext.todos.length} {t('ctx.completed')}
                    </span>
                  </header>
                  <div className="divide-y divide-slate-800">
                    {sessionContext.todos.map(todo => (
                      <div key={todo.id} className="px-4 py-2.5 flex items-start gap-3">
                        <span className={`mt-0.5 text-sm ${
                          todo.status === 'done' ? 'text-emerald-400' :
                          todo.status === 'in_progress' ? 'text-amber-400' :
                          todo.status === 'blocked' ? 'text-rose-400' :
                          'text-slate-500'
                        }`}>
                          {todo.status === 'done' ? '✅' :
                           todo.status === 'in_progress' ? '🔄' :
                           todo.status === 'blocked' ? '🚫' : '⬜'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-slate-200">{todo.title}</div>
                          {todo.description && (
                            <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{todo.description}</div>
                          )}
                        </div>
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                          todo.status === 'done' ? 'bg-emerald-500/20 text-emerald-300' :
                          todo.status === 'in_progress' ? 'bg-amber-500/20 text-amber-300' :
                          todo.status === 'blocked' ? 'bg-rose-500/20 text-rose-300' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {todo.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {sessionContext.checkpoints.length > 0 && (
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                  <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                    <span className="text-lg">📍</span>
                    <h3 className="text-sm font-semibold text-slate-200">{t('ctx.checkpoints')}</h3>
                    <span className="text-[11px] text-slate-500 ml-auto">
                      {sessionContext.checkpoints.length} {t('ctx.entries')}
                    </span>
                  </header>
                  <div className="divide-y divide-slate-800">
                    {[...sessionContext.checkpoints].reverse().map((cp, i) => {
                      const s = cp.sections;
                      const num = sessionContext.checkpoints.length - i;
                      const sectionList: { key: string; icon: string; label: string; text: string }[] = [];
                      if (s.overview) sectionList.push({ key: 'overview', icon: '📋', label: t('ctx.sec_overview'), text: s.overview });
                      if (s.work_done) sectionList.push({ key: 'work_done', icon: '✅', label: t('ctx.sec_work_done'), text: s.work_done });
                      if (s.history) sectionList.push({ key: 'history', icon: '📜', label: t('ctx.sec_history'), text: s.history });
                      if (s.next_steps) sectionList.push({ key: 'next_steps', icon: '🎯', label: t('ctx.sec_next_steps'), text: s.next_steps });
                      if (s.technical_details) sectionList.push({ key: 'technical', icon: '⚙️', label: t('ctx.sec_technical'), text: s.technical_details });
                      if (s.important_files) sectionList.push({ key: 'files', icon: '📁', label: t('ctx.sec_files'), text: s.important_files });
                      return (
                        <details key={cp.filename} className="group">
                          <summary className="px-4 py-2.5 cursor-pointer text-[12px] font-medium text-slate-200 hover:bg-slate-800/30 flex items-center gap-2">
                            <span className="text-[10px] text-cyan-400/80 tabular-nums w-6 font-mono">#{String(num).padStart(2, '0')}</span>
                            <span className="flex-1">{cp.title}</span>
                            {s.overview && <span className="text-[10px] text-slate-600 max-w-[300px] truncate hidden lg:inline">{s.overview.slice(0, 80)}</span>}
                            <span className="text-[10px] text-slate-600 group-open:rotate-90 transition-transform">▶</span>
                          </summary>
                          <div className="border-t border-slate-800/50 ml-8">
                            {sectionList.length > 0 ? (
                              <div className="divide-y divide-slate-800/50">
                                {sectionList.map(sec => (
                                  <details key={sec.key} className="group/sec" open={sec.key === 'overview' || sec.key === 'work_done'}>
                                    <summary className="px-4 py-2 cursor-pointer text-[11px] text-slate-300 hover:bg-slate-800/20 flex items-center gap-1.5">
                                      <span>{sec.icon}</span>
                                      <span className="font-medium">{sec.label}</span>
                                      <span className="text-[10px] text-slate-600 ml-auto group-open/sec:rotate-90 transition-transform">▸</span>
                                    </summary>
                                    <div
                                      className="px-4 pb-3 text-[11px] text-slate-400 leading-relaxed max-h-[300px] overflow-y-auto"
                                      dangerouslySetInnerHTML={{ __html: renderMarkdown(sec.text) }}
                                    />
                                  </details>
                                ))}
                              </div>
                            ) : (
                              <div
                                className="px-4 py-3 text-[11px] text-slate-400 leading-relaxed max-h-[400px] overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(cp.content) }}
                              />
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </section>
              )}

              {instructions && instructions.project_files.length > 0 && (
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                  <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                    <span className="text-lg">📜</span>
                    <h3 className="text-sm font-semibold text-slate-200">{t('ctx.agent_instructions')}</h3>
                    <span className="ml-auto text-[10px] text-slate-500">{instructions.project_files.length} {lang === 'zh' ? '个文件' : 'files'}</span>
                  </header>
                  <div className="divide-y divide-slate-800/50">
                    {instructions.project_files.map(f => (
                      <details key={f.rel_path} className="group">
                        <summary className="px-4 py-2.5 cursor-pointer text-[12px] text-slate-300 hover:bg-slate-800/30 flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 group-open:rotate-90 transition-transform">▶</span>
                          <span className="font-mono text-slate-400">{f.rel_path}</span>
                          <span className="ml-auto text-[10px] text-slate-600">{f.bytes > 1024 ? `${(f.bytes / 1024).toFixed(1)}KB` : `${f.bytes}B`}</span>
                        </summary>
                        <div
                          className="px-4 pb-3 text-[11px] text-slate-400 leading-relaxed max-h-[400px] overflow-y-auto prose-sm"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(f.content) }}
                        />
                      </details>
                    ))}
                  </div>
                  {instructions.global_instructions && (
                    <details className="group border-t border-slate-800/50">
                      <summary className="px-4 py-2.5 cursor-pointer text-[12px] text-slate-300 hover:bg-slate-800/30 flex items-center gap-2">
                        <span className="text-[10px] text-slate-600 group-open:rotate-90 transition-transform">▶</span>
                        <span className="font-mono text-slate-400">{t('ctx.global_instructions')}</span>
                      </summary>
                      <div
                        className="px-4 pb-3 text-[11px] text-slate-400 leading-relaxed max-h-[400px] overflow-y-auto prose-sm"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(instructions.global_instructions) }}
                      />
                    </details>
                  )}
                </section>
              )}

              {!sessionContext.plan && sessionContext.todos.length === 0 && sessionContext.checkpoints.length === 0 && (!instructions || instructions.project_files.length === 0) && (
                <div className="text-center py-16 text-slate-500">
                  <div className="text-4xl mb-3">📭</div>
                  <p className="text-sm">{t('ctx.empty')}</p>
                </div>
              )}
            </div>
          ) : (
        <div className="p-6 space-y-6">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label={t('stat.turns')} value={detail.turns} />
            <StatCard label={t('stat.user_msgs')} value={detail.user_messages} hint={t('misc.inbound')} />
            <StatCard label={t('stat.assistant_msgs')} value={detail.assistant_messages} hint={t('misc.outbound')} />
            <StatCard label={t('stat.tool_calls')} value={toolsTotal} hint={`${tools.length} ${t('misc.unique')}`} />
          </section>

          {(() => {
            const firstPromptT = detail.prompts?.find(p => p.timestamp)?.timestamp;
            const startISO = firstPromptT || meta?.started_at;
            const endISO = meta?.last_event_at;
            if (!startISO || !endISO) return null;
            const startMs = new Date(startISO).getTime();
            const endMs = new Date(endISO).getTime();
            const durMs = Math.max(0, endMs - startMs);
            if (durMs < 1000) return null;
            const fmtDur = (ms: number): string => {
              const s = Math.floor(ms / 1000);
              if (s < 60) return `${s}s`;
              const m = Math.floor(s / 60);
              if (m < 60) return `${m}m ${s % 60}s`;
              const h = Math.floor(m / 60);
              if (h < 24) return `${h}h ${m % 60}m`;
              const d = Math.floor(h / 24);
              return `${d}d ${h % 24}h`;
            };
            const promptCount = detail.prompts?.length ?? 0;
            const turns = detail.turns || 0;
            const promptsPerHour = durMs > 0 ? (promptCount / (durMs / 3600000)) : 0;
            const turnsPerHour = durMs > 0 ? (turns / (durMs / 3600000)) : 0;
            const isFirstPrompt = !!firstPromptT;
            return (
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label={t('stat.duration')}
                  value={fmtDur(durMs)}
                  hint={isFirstPrompt ? t('misc.from_first_prompt') : t('misc.from_session_start')}
                />
                <StatCard
                  label={t('stat.first_event')}
                  value={new Date(startISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  hint={new Date(startISO).toLocaleDateString()}
                />
                <StatCard
                  label={t('stat.prompts_per_hour')}
                  value={promptsPerHour < 0.1 ? promptsPerHour.toFixed(2) : promptsPerHour.toFixed(1)}
                  hint={`${promptCount} ${t('misc.prompts')}`}
                />
                <StatCard
                  label={t('stat.turns_per_hour')}
                  value={turnsPerHour < 0.1 ? turnsPerHour.toFixed(2) : turnsPerHour.toFixed(1)}
                  hint={`${turns} ${t('stat.turns').toLowerCase()}`}
                />
              </section>
            );
          })()}

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

          {/* Instructions / Persona section */}
          {instructions && (instructions.project_files.length > 0 || instructions.global_instructions) && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/40">
              <details>
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-200 hover:bg-slate-800/30">
                  📜 {t('detail.instructions')} ({instructions.project_files.length} {lang === 'zh' ? '个文件' : 'files'})
                </summary>
                <div className="px-4 pb-4 space-y-3">
                  {instructions.global_instructions && (
                    <div>
                      <div className="text-[11px] text-slate-500 mb-1">{t('detail.global_instructions')}</div>
                      <pre className="text-[11px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300 max-h-60 overflow-y-auto">
                        {instructions.global_instructions}
                      </pre>
                    </div>
                  )}
                  {instructions.project_files.map(f => (
                    <div key={f.rel_path}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] text-slate-400 font-mono">{f.rel_path}</span>
                        <span className="text-[10px] text-slate-600">{f.bytes}B</span>
                        <CopyButton text={f.content} />
                      </div>
                      <pre className="text-[11px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300 max-h-60 overflow-y-auto">
                        {f.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          {/* System Prompts section */}
          {systemPrompts.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/40">
              <details>
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-200 hover:bg-slate-800/30">
                  ⚙ {t('detail.system_prompts')} ({systemPrompts.length})
                </summary>
                <div className="px-4 pb-4 space-y-3">
                  {systemPrompts.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] text-slate-500 font-mono">
                          {new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <CopyButton text={p.content} />
                      </div>
                      <pre className="text-[11px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300 max-h-60 overflow-y-auto">
                        {p.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          <ToolTimeline calls={detail.tool_calls ?? []} />

          <ReplaySection
            prompts={(detail.prompts ?? []).filter(p => p.timestamp).map(p => ({
              kind: 'prompt' as const,
              timestamp: p.timestamp!,
              label: p.snippet || p.text || '(prompt)',
              full: p.text || p.snippet || '',
            }))}
            tools={(detail.tool_calls ?? []).map(c => ({
              kind: 'tool' as const,
              timestamp: c.timestamp,
              label: c.name,
              full: c.name,
            }))}
            sessionId={meta?.id ?? ''}
            t={t}
          />

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
        </>
      )}
    </main>
  );
}

const TIMELINE_COLORS = [
  '#22d3ee', '#34d399', '#a78bfa', '#fbbf24', '#fb7185',
  '#fb923c', '#60a5fa', '#f472b6', '#4ade80', '#facc15',
];

type TimelineCall = {
  name: string;
  timestamp: string;
  args_summary?: string | null;
  result_snippet?: string | null;
  success?: boolean | null;
};

function ToolTimeline({ calls }: { calls: TimelineCall[] }) {
  const { t, lang } = useT();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
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
            {filtered.map((c) => {
              const tt = new Date(c.timestamp).getTime();
              const pct = ((tt - min) / span) * 100;
              const color = colorMap.get(c.name) ?? '#94a3b8';
              const idx = calls.indexOf(c);
              const isSelected = selectedIdx === idx;
              return (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setSelectedIdx(isSelected ? null : idx)}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full transition-transform hover:scale-150 cursor-pointer"
                  style={{
                    left: `${pct}%`,
                    background: color,
                    boxShadow: isSelected
                      ? `0 0 0 2px #f8fafc`
                      : `0 0 0 1.5px rgba(15,23,42,1)`,
                  }}
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
        {/* Inspector panel */}
        {selectedIdx !== null && calls[selectedIdx] && (() => {
          const c = calls[selectedIdx];
          const noDetail = !c.args_summary && !c.result_snippet && c.success == null;
          return (
            <div className="mt-3 rounded border border-slate-700 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-100">{c.name}</span>
                  {c.success === true && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 text-[10px]">
                      {t('timeline.success')}
                    </span>
                  )}
                  {c.success === false && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 text-[10px]">
                      {t('timeline.failure')}
                    </span>
                  )}
                  <span className="text-slate-500 tabular-nums">
                    {new Date(c.timestamp).toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIdx(null)}
                  className="px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >×</button>
              </div>
              {noDetail ? (
                <div className="text-[11px] text-slate-500 italic">{t('timeline.no_detail')}</div>
              ) : (
                <div className="space-y-2">
                  {c.args_summary && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                        {t('timeline.args')}
                      </div>
                      <pre className="text-[11px] text-slate-300 bg-slate-900/60 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {c.args_summary}
                      </pre>
                    </div>
                  )}
                  {c.result_snippet && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                        {t('timeline.result')}
                      </div>
                      <pre className="text-[11px] text-slate-300 bg-slate-900/60 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {c.result_snippet}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </section>
  );
}
