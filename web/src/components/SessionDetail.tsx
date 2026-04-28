type Props = { meta: any; detail: any };
export function SessionDetail({ meta, detail }: Props) {
  if (!meta) return <main className="flex-1 grid place-items-center text-slate-500">Select a session</main>;
  return (
    <main className="flex-1 p-6 overflow-y-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{meta.summary || meta.id}</h1>
        <div className="text-sm text-slate-400 font-mono mt-1">{meta.id}</div>
        <div className="flex gap-4 mt-3 text-sm">
          <span>📁 {meta.cwd}</span>
          <span>🌿 {meta.branch}</span>
          <span>🤖 {meta.model || '—'}</span>
          <span className={meta.status==='active'?'text-green-400':'text-slate-500'}>● {meta.status}</span>
        </div>
      </header>
      {detail && (
        <section className="grid grid-cols-2 gap-4">
          <div className="rounded bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-400">Turns</div>
            <div className="text-3xl">{detail.turns}</div>
          </div>
          <div className="rounded bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-400">Messages</div>
            <div className="text-3xl">↑ {detail.user_messages} / ↓ {detail.assistant_messages}</div>
          </div>
          <div className="rounded bg-slate-900 p-4 col-span-2">
            <div className="text-xs uppercase text-slate-400">Tools used</div>
            <ul className="mt-2 text-sm">
              {Object.entries(detail.tools_used || {}).map(([k,v]) => (
                <li key={k} className="flex justify-between"><span>{k}</span><span className="text-slate-400">×{v as number}</span></li>
              ))}
            </ul>
          </div>
          <div className="rounded bg-slate-900 p-4 col-span-2">
            <div className="text-xs uppercase text-slate-400">Skills invoked</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(detail.skills_invoked || []).map((s: string, i: number) => (
                <span key={i} className="px-2 py-1 rounded bg-slate-800 text-xs">{s}</span>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
