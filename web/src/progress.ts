// Global fetch interceptor that tracks inflight /api/* requests.
// Components can subscribe via window event 'pawscope:progress' (detail = count)
// and 'pawscope:progress-error' (fired on non-2xx response or network error).

let installed = false;
let inflight = 0;

function emit() {
  window.dispatchEvent(new CustomEvent('pawscope:progress', { detail: inflight }));
}

function emitError() {
  window.dispatchEvent(new CustomEvent('pawscope:progress-error'));
}

export function installProgress() {
  if (installed) return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const tracked = url.includes('/api/');
    if (tracked) {
      inflight += 1;
      emit();
    }
    try {
      const res = await orig(input, init);
      if (tracked && !res.ok) emitError();
      return res;
    } catch (e) {
      if (tracked) emitError();
      throw e;
    } finally {
      if (tracked) {
        inflight = Math.max(0, inflight - 1);
        emit();
      }
    }
  };
}

export function subscribeProgress(cb: (count: number) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<number>).detail);
  window.addEventListener('pawscope:progress', handler);
  return () => window.removeEventListener('pawscope:progress', handler);
}

export function subscribeProgressError(cb: () => void): () => void {
  window.addEventListener('pawscope:progress-error', cb);
  return () => window.removeEventListener('pawscope:progress-error', cb);
}
