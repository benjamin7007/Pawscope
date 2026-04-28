export async function fetchSessions() {
  const r = await fetch('/api/sessions');
  return r.json();
}
export async function fetchDetail(id: string) {
  const r = await fetch(`/api/sessions/${id}`);
  return r.json();
}
export function connectWs(onEvent: (ev: any) => void): WebSocket {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => { try { onEvent(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => setTimeout(() => connectWs(onEvent), 1000);
  return ws;
}
