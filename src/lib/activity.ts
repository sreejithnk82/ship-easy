// Tracks how many foreground backend requests are in flight, so the UI can show
// a global "something is happening" indicator (see components/ActivityBar.tsx).
//
// Driven from the single choke point callApi() in api.ts: every non-background
// call bumps the counter on start and drops it in a finally. This is a plain
// module-level store (same listener pattern as auth.ts) exposed for React's
// useSyncExternalStore — getActivitySnapshot returns a primitive, so no tearing.

let inflight = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const beginRequest = () => { inflight++; emit(); };
export const endRequest = () => { inflight = Math.max(0, inflight - 1); emit(); };

export const subscribeActivity = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const getActivitySnapshot = () => inflight;
