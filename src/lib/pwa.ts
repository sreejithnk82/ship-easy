// Force-check for a new app version on demand (the Refresh button), separate
// from the passive ReloadPrompt banner. vite-plugin-pwa's generated service
// worker activates a waiting worker when it receives {type:'SKIP_WAITING'};
// we trigger an update check, push the new worker through, and reload.

export type UpdateResult = 'updating' | 'current' | 'unsupported';

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
