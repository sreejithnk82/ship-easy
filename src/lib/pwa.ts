// Force-check for a new app version on demand (the Refresh button), separate
// from the passive ReloadPrompt banner. vite-plugin-pwa's generated service
// worker activates a waiting worker when it receives {type:'SKIP_WAITING'};
// we trigger an update check, push the new worker through, and reload.

export type UpdateResult = 'updating' | 'current' | 'unsupported';

/**
 * Ask the browser to treat this origin's storage (IndexedDB + localStorage) as
 * durable so it isn't auto-evicted under storage pressure. Installed PWAs are
 * usually granted silently. Best-effort — safe to call on every start.
 * NOTE: this does NOT survive a manual "Clear browsing data"; it only prevents
 * automatic eviction.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true; // already durable
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function checkAppUpdate(): Promise<UpdateResult> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';

  await reg.update(); // ask the browser to re-fetch the SW and check for changes

  // A worker that's already waiting, or one that finishes installing now.
  const activate = (worker: ServiceWorker) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  if (reg.waiting) { activate(reg.waiting); return 'updating'; }

  if (reg.installing) {
    const sw = reg.installing;
    return await new Promise<UpdateResult>((resolve) => {
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) { activate(sw); resolve('updating'); }
        else if (sw.state === 'activated' || sw.state === 'redundant') resolve('current');
      });
    });
  }

  return 'current';
}
