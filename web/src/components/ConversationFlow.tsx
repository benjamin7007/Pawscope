import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { connectWs } from '../api';

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
      <div className="py-1.5 pl-3 border-l-2 border-cyan-500/30">
        <div className="flex items-baseline gap-2">
          <span className="text-cyan-300 text-[11px]">🤖</span>
          <span className="text-[10px] text-slate-500 font-mono">{timeOnly(item.at)}</span>
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
}: {
  interaction: Interaction;
  index: number;
  defaultOpen: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [showTransformed, setShowTransformed] = useState(false);
  const isHuman = interaction.kind === 'human';
  const raw = interaction.user_message_raw || '';
  const transformed = interaction.user_message_transformed || '';
  const hasTransformed = transformed && transformed !== raw;
  const shown = showTransformed && hasTransformed ? transformed : raw;
  const isTruncated = shown.length > 800;
  const display = isTruncated ? shown.slice(0, 800) + '…' : shown;

  return (
    <article className="border border-slate-800 rounded-md bg-slate-900/40">
      <header
        className="flex items-baseline gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/40 select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-slate-500 text-xs">{open ? '▼' : '▶'}</span>
        <span className="text-[11px] text-slate-500 font-mono">#{index}</span>
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
              </div>
              <pre className="text-[12px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-200 max-h-64 overflow-y-auto">
                {display}
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
  const cancelRef = useRef(false);
  const lastVersionRef = useRef(0);
  const refetchTimerRef = useRef<number | null>(null);

  const fetchLog = (initial: boolean) => {
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
    <div className="px-6 py-4 space-y-3">
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
                <div className="text-[10px] text-slate-500 font-mono">{timeOnly(p.at)}</div>
                <pre className="text-[11px] bg-slate-950/60 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-300 max-h-96 overflow-y-auto">
                  {p.content}
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
              defaultOpen={i >= log.interactions.length - 3}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
