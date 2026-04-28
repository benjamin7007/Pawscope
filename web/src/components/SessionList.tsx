type Props = { items: any[]; onSelect: (id: string) => void; selected: string | null };
export function SessionList({ items, onSelect, selected }: Props) {
  return (
    <aside className="w-80 border-r border-slate-800 overflow-y-auto">
      <h2 className="px-4 py-3 text-sm uppercase text-slate-400">Sessions</h2>
      {items.map(s => (
        <button key={s.id}
          onClick={() => onSelect(s.id)}
          className={`block w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-900 ${selected===s.id?'bg-slate-900':''}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${s.status==='active'?'bg-green-400':'bg-slate-500'}`}/>
            <span className="font-mono text-xs">{s.id.slice(0,8)}</span>
          </div>
          <div className="text-sm mt-1 truncate">{s.summary || s.repo || '(no summary)'}</div>
          <div className="text-xs text-slate-500">{s.branch || '—'}</div>
        </button>
      ))}
    </aside>
  );
}
