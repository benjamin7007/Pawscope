import { useEffect, useState } from 'react';
import './styles.css';
import { fetchSessions, fetchDetail, connectWs } from './api';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';

export default function App() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => { fetchSessions().then(setSessions); }, []);
  useEffect(() => {
    const ws = connectWs((ev) => {
      if (ev?.kind === 'session_list_changed') {
        fetchSessions().then(setSessions);
      } else if (ev?.kind === 'detail_updated' && selected === ev.session_id) {
        setDetail(ev.detail);
      }
    });
    return () => ws.close();
  }, [selected]);
  useEffect(() => { if (selected) fetchDetail(selected).then(setDetail); }, [selected]);

  return (
    <div className="flex h-screen">
      <SessionList items={sessions} onSelect={setSelected} selected={selected}/>
      <SessionDetail meta={sessions.find(s => s.id === selected)} detail={detail}/>
    </div>
  );
}
