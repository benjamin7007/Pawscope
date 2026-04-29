import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { connectWs } from '../api';

// Common secret patterns (high-signal, low false-positive). Matches are
// wrapped with a rose-tinted span so users notice before copying or sharing.
// Keep this list conservative — over-matching erodes trust in the highlight.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'openai', re: /\bsk-[A-Za-z0-9-_]{16,}\b/g },
  { name: 'github', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: 'aws-akid', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi },
  { name: 'apikey-kv', re: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._\-+/]{12,}["']?/gi },
];

function highlightSecrets(text: string): React.ReactNode {
  if (!text) return text;
  type Hit = { start: number; end: number };
  const hits: Hit[] = [];
  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (hits.length === 0) return text;
  hits.sort((a, b) => a.start - b.start);
  // Merge overlaps
  const merged: Hit[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else merged.push({ ...h });
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((h, i) => {
    if (cursor < h.start) parts.push(text.slice(cursor, h.start));
    parts.push(
      <span key={i} className="bg-rose-500/25 text-rose-200 px-0.5 rounded" title="possible secret">
        {text.slice(h.start, h.end)}
      </span>,
    );
    cursor = h.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
      title="copy"
    >
      {done ? '✓' : (label ?? '⧉')}
    </button>
  );
}

// --- Types mirroring pawscope-core ConversationLog ---
export type TurnItem =
  | { kind: 'assistant_message'; at: string; content: string }
  | {
      kind: 'tool';
      name: string;
      at: string;
      args_summary?: string | null;
      result_snippet?: string | null;
      success?: boolean | null;
    }
  | {
      kind: 'subagent';
      started_at: string;
      completed_at?: string | null;
      agent_type?: string | null;
      task?: string | null;
      items: TurnItem[];
    };

export type AssistantTurn = {
  turn_id: string;
  started_at: string;
  completed_at?: string | null;
  items: TurnItem[];
};

export type Interaction = {
  interaction_id: string;
  started_at: string;
  user_message_raw?: string | null;
  user_message_transformed?: string | null;
  kind: 'human' | 'injected_context';
  turns: AssistantTurn[];
};

export type SystemPromptMarker = { at: string; content: string };
export type CompactionMarker = { started_at: string; completed_at?: string | null };

export type ConversationLog = {
  system_prompts: SystemPromptMarker[];
  compaction_markers: CompactionMarker[];
  interactions: Interaction[];
  version: number;
};

// --- Helpers ---
function timeOnly(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function durationMs(a: string, b?: string | null): string | null {
  if (!b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

// --- Item rendering ---
function ItemBlock({ item, depth }: { item: TurnItem; depth: number }) {
  const { t } = useT();
  if (item.kind === 'assistant_message') {
    return (
      <div className="py-1.5 pl-3 border-l-2 border-cyan-500/30 group">
        <div className="flex items-baseline gap-2">
          <span className="text-cyan-300 text-[11px]">🤖</span>
          <span className="text-[10px] text-slate-500 font-mono">{timeOnly(item.at)}</span>
          <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyBtn text={item.content} />
          </span>
        </div>
        <div className="mt-1 text-[12px] text-slate-200 whitespace-pre-wrap break-words">
          {item.content}
        </div>
      </div>
    );
  }
  if (item.kind === 'tool') {
    const ok = item.success === true;
    const fail = item.success === false;
    return (
      <div className="py-1.5 pl-3 border-l-2 border-amber-500/30">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-amber-300 text-[11px]">🔧</span>
          <span className="text-[12px] font-mono text-amber-200">{item.name}</span>
          <span className="text-[10px] text-slate-500 font-mono">{timeOnly(item.at)}</span>
          {ok && <span className="text-[10px] text-emerald-400">✓</span>}
          {fail && <span className="text-[10px] text-rose-400">✗</span>}
        </div>
        {item.args_summary && (
          <details className="mt-1">
            <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">args</summary>
            <pre className="mt-1 text-[10px] bg-slate-900/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300">
              {item.args_summary}
            </pre>
          </details>
        )}
        {item.result_snippet && (
          <details className="mt-1">
            <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">result</summary>
            <pre className="mt-1 text-[10px] bg-slate-900/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300">
              {item.result_snippet}
            </pre>
          </details>
        )}
      </div>
    );
  }
  // subagent
  return (
    <div className="my-2 pl-3 border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r">
      <div className="flex items-baseline gap-2 flex-wrap py-1">
        <span className="text-violet-300 text-[11px]">👥</span>
        <span className="text-[11px] font-medium text-violet-200">
          {t('flow.subagent')} {item.agent_type ? `· ${item.agent_type}` : ''}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          {timeOnly(item.started_at)}
          {item.completed_at && ` → ${timeOnly(item.completed_at)}`}
        </span>
        {durationMs(item.started_at, item.completed_at) && (
          <span className="text-[10px] text-slate-500">({durationMs(item.started_at, item.completed_at)})</span>
        )}
      </div>
      {item.task && (
        <div className="text-[11px] text-slate-400 italic pb-1 pr-2">
          {item.task.slice(0, 200)}
          {item.task.length > 200 ? '…' : ''}
        </div>
      )}
      <div className="space-y-0.5 pb-1">
        {item.items.map((child, i) => (
          <ItemBlock key={i} item={child} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

function TurnBlock({ turn, idx }: { turn: AssistantTurn; idx: number }) {
  const { t } = useT();
  const dur = durationMs(turn.started_at, turn.completed_at);
  return (
    <div className="ml-4 mt-2">
      <div className="flex items-baseline gap-2 text-[11px] text-slate-400 mb-1">
        <span className="text-slate-500">─</span>
        <span className="font-medium text-slate-300">{t('flow.assistant_turn')} {idx + 1}</span>
        <span className="font-mono text-slate-500">
          {timeOnly(turn.started_at)}
          {turn.completed_at && ` → ${timeOnly(turn.completed_at)}`}
        </span>
        {dur && <span className="text-slate-500">({dur})</span>}
        {turn.completed_at ? <span className="text-emerald-400">✓</span> : <span className="text-amber-400 animate-pulse">…</span>}
      </div>
      <div className="ml-3 space-y-0.5">
        {turn.items.map((it, i) => (
          <ItemBlock key={i} item={it} depth={0} />
        ))}
      </div>
    </div>
  );
}

function InteractionBlock({
  interaction,
  index,
  defaultOpen,
  highlight,
}: {
  interaction: Interaction;
  index: number;
  defaultOpen: boolean;
  highlight: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [showTransformed, setShowTransformed] = useState(false);
  // Re-open if deep-link target arrives later (initial defaultOpen was already
  // applied; also respond when user navigates to #i=N after first render).
  useEffect(() => {
    if (highlight) setOpen(true);
  }, [highlight]);
  const isHuman = interaction.kind === 'human';
  const raw = interaction.user_message_raw || '';
  const transformed = interaction.user_message_transformed || '';
  const hasTransformed = transformed && transformed !== raw;
  const shown = showTransformed && hasTransformed ? transformed : raw;
  const isTruncated = shown.length > 800;
  const display = isTruncated ? shown.slice(0, 800) + '…' : shown;

  return (
    <article
      id={`i-${index}`}
      className={`border rounded-md transition-colors ${
        highlight
          ? 'border-cyan-500/60 bg-cyan-500/5 ring-1 ring-cyan-500/30'
          : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <header
        className="flex items-baseline gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/40 select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-slate-500 text-xs">{open ? '▼' : '▶'}</span>
        <a
          href={`#i=${index}`}
          onClick={(e) => {
            e.stopPropagation();
            // Update hash without forcing the browser to scroll-jump.
            history.replaceState(null, '', `#i=${index}`);
          }}
          className="text-[11px] text-slate-500 font-mono hover:text-cyan-300"
          title={t('flow.copy_link')}
        >
          #{index}
        </a>
        <span className="text-[11px] text-slate-500 font-mono">{timeOnly(interaction.started_at)}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            isHuman
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'bg-slate-700/50 text-slate-400 border border-slate-700'
          }`}
        >
          {isHuman ? t('flow.user_human') : t('flow.user_injected')}
        </span>
        <span className="text-[10px] text-slate-500 ml-auto">
          {interaction.turns.length} {t('flow.turns_short')}
        </span>
      </header>
      {open && (
        <div className="px-3 pb-3">
          {raw && (
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {showTransformed && hasTransformed ? t('flow.transformed') : t('flow.raw')}
                </span>
                {hasTransformed && (
                  <button
                    onClick={() => setShowTransformed((v) => !v)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    {showTransformed ? t('flow.show_raw') : t('flow.show_transformed')}
                  </button>
                )}
                <span className="ml-auto"><CopyBtn text={shown} /></span>
              </div>
              <pre className="text-[12px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-200 max-h-64 overflow-y-auto">
                {highlightSecrets(display)}
              </pre>
            </div>
          )}
          {interaction.turns.map((turn, i) => (
            <div
              key={turn.turn_id}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '120px 200px' }}
            >
              <TurnBlock turn={turn} idx={i} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// --- Main ---
type Props = { sessionId: string };

export function ConversationFlow({ sessionId }: Props) {
  const { t } = useT();
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const lastVersionRef = useRef(0);
  const refetchTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Was the user near the bottom *before* this render? Captured during render
  // so the post-render effect can decide whether to autoscroll.
  const wasNearBottomRef = useRef(true);

  // Read deep-link `#i=N` on mount and whenever hash changes.
  const readHash = useCallback(() => {
    const h = window.location.hash || '';
    const m = h.match(/i=(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) setHighlightIdx(n);
    } else {
      setHighlightIdx(null);
    }
  }, []);
  useEffect(() => {
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [readHash]);

  const fetchLog = (initial: boolean) => {
    // Capture scroll position relative to the page bottom *before* state mutates.
    const sc = (containerRef.current?.closest('main') as HTMLElement | null) ?? document.scrollingElement;
    if (sc) {
      const distFromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
      wasNearBottomRef.current = distFromBottom < 120;
    }
    if (initial) {
      setLoading(true);
      setError(null);
    }
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/conversation`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d: ConversationLog | null) => {
        if (cancelRef.current) return;
        if (d) lastVersionRef.current = d.version;
        setLog(d);
        if (initial) setLoading(false);
      })
      .catch((e) => {
        if (cancelRef.current) return;
        if (initial) {
          setError(String(e));
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    cancelRef.current = false;
    setLog(null);
    setError(null);
    lastVersionRef.current = 0;
    fetchLog(true);

    // Subscribe to WS conversation_updated events. Debounce refetches by 250ms
    // to coalesce rapid bursts (auto-continuation can fire many turn ends per
    // second). Version-based guard prevents stale refetches from clobbering
    // newer state on reconnect.
    const ws = connectWs((ev: any) => {
      if (cancelRef.current) return;
      if (ev?.kind !== 'conversation_updated' || ev.session_id !== sessionId) return;
      if (typeof ev.version === 'number' && ev.version <= lastVersionRef.current) return;
      setLive(true);
      if (refetchTimerRef.current != null) window.clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = window.setTimeout(() => {
        if (!cancelRef.current) fetchLog(false);
      }, 250);
    });

    return () => {
      cancelRef.current = true;
      if (refetchTimerRef.current != null) window.clearTimeout(refetchTimerRef.current);
      try {
        ws.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const totalTurns = useMemo(
    () => (log ? log.interactions.reduce((acc, it) => acc + it.turns.length, 0) : 0),
    [log],
  );

  // Auto-scroll to bottom after live updates, but only if the user was near the
  // bottom before this update — preserves their scroll position when reading
  // older interactions.
  useEffect(() => {
    if (!log) return;
    if (highlightIdx != null) {
      // Deep-link wins over autoscroll. Scroll to the targeted card.
      const el = document.getElementById(`i-${highlightIdx}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (wasNearBottomRef.current) {
      const sc = (containerRef.current?.closest('main') as HTMLElement | null) ?? document.scrollingElement;
      if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    }
  }, [log, highlightIdx]);

  if (loading) {
    return <div className="px-6 py-8 text-sm text-slate-500">{t('detail.loading')}</div>;
  }
  if (error) {
    return (
      <div className="px-6 py-8 text-sm text-rose-400">
        {t('flow.load_error')}: {error}
      </div>
    );
  }
  if (!log || (log.interactions.length === 0 && log.system_prompts.length === 0)) {
    return <div className="px-6 py-8 text-sm text-slate-500">{t('flow.empty')}</div>;
  }

  return (
    <div ref={containerRef} className="px-6 py-4 space-y-3">
      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-3">
        <span>v{log.version}</span>
        {live && (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t('flow.live')}
          </span>
        )}
        <span>·</span>
        <span>{log.interactions.length} {t('flow.interactions_short')}</span>
        <span>·</span>
        <span>{totalTurns} {t('flow.turns_short')}</span>
        {log.compaction_markers.length > 0 && (
          <>
            <span>·</span>
            <span>{log.compaction_markers.length} {t('flow.compactions_short')}</span>
          </>
        )}
      </div>

      {log.system_prompts.length > 0 && (
        <details
          open={systemOpen}
          onToggle={(e) => setSystemOpen((e.target as HTMLDetailsElement).open)}
          className="border border-slate-800 rounded bg-slate-900/30"
        >
          <summary className="px-3 py-2 cursor-pointer text-[12px] text-slate-300 hover:bg-slate-800/40">
            ⚙ {t('flow.system_prompt')} ({log.system_prompts.length})
            <span className="ml-2 text-[10px] text-amber-400">{t('flow.secret_warning')}</span>
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {log.system_prompts.map((p, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-mono">{timeOnly(p.at)}</span>
                  <span className="ml-auto"><CopyBtn text={p.content} /></span>
                </div>
                <pre className="text-[11px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300 max-h-96 overflow-y-auto">
                  {highlightSecrets(p.content)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="space-y-2">
        {log.interactions.map((it, i) => (
          <div
            key={it.interaction_id}
            // Native virtualization: browser skips render/layout/paint of off-screen
            // cards. contain-intrinsic-size gives a placeholder height so the scrollbar
            // is stable. Auto means: while off-screen, treat as having intrinsic size.
            style={{ contentVisibility: 'auto', containIntrinsicSize: '300px 800px' }}
          >
            <InteractionBlock
              interaction={it}
              index={i}
              defaultOpen={i >= log.interactions.length - 3 || i === highlightIdx}
              highlight={i === highlightIdx}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
