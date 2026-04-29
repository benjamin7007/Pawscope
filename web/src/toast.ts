// Lightweight toast system. Components/anyone fires window event:
//   toast.success('saved') / toast.error('failed') / toast.info('hello')
// ToastContainer renders them at bottom-right with auto-dismiss.

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastPayload {
  id: number;
  kind: ToastKind;
  message: string;
  ttl: number;
}

let nextId = 1;

function fire(kind: ToastKind, message: string, ttl = 3500) {
  const detail: ToastPayload = { id: nextId++, kind, message, ttl };
  window.dispatchEvent(new CustomEvent('pawscope:toast', { detail }));
}

export const toast = {
  success: (msg: string, ttl?: number) => fire('success', msg, ttl),
  error: (msg: string, ttl?: number) => fire('error', msg, ttl ?? 5000),
  info: (msg: string, ttl?: number) => fire('info', msg, ttl),
};

export function subscribeToast(cb: (t: ToastPayload) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ToastPayload>).detail);
  window.addEventListener('pawscope:toast', handler);
  return () => window.removeEventListener('pawscope:toast', handler);
}
