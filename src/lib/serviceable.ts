// Serviceable-pincode list. The full list lives in one Directory sheet and is
// fetched in a single call, then cached in localStorage so booking validation is
// instant and works offline. Refresh it from the Refresh button.

import { api } from './api';

const KEY = 'shipeasy.serviceablePincodes';

type Cache = { pincodes: string[]; at: number };

function read(): Cache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && Array.isArray(c.pincodes)) return c;
  } catch { /* ignore */ }
  return null;
}

/** The cached serviceable pincodes as a Set (empty if never fetched). */
export function serviceableSet(): Set<string> {
  const c = read();
  return new Set(c ? c.pincodes : []);
}

/** When the list was last refreshed (ms epoch), or 0 if never. */
export function serviceableUpdatedAt(): number {
  return read()?.at ?? 0;
}

/** How many pincodes are cached. */
export function serviceableCount(): number {
  return read()?.pincodes.length ?? 0;
}

/**
 * Is this pincode serviceable? Fails OPEN: if we have no list cached yet (never
 * refreshed), we don't block bookings — only once a real list exists do we
 * enforce membership.
 */
export function isServiceable(pin: string | number | null | undefined): boolean {
  const digits = String(pin ?? '').replace(/\D/g, '');
  const set = serviceableSet();
  if (set.size === 0) return true; // no list yet → don't block
  return set.has(digits);
}

/** Fetch the full list from the server and cache it. Returns the count. */
export async function refreshServiceablePincodes(): Promise<number> {
  const { pincodes } = await api.listServiceablePincodes();
  const clean = Array.from(new Set(pincodes.map((p) => String(p).replace(/\D/g, '')).filter((p) => p.length === 6)));
  try { localStorage.setItem(KEY, JSON.stringify({ pincodes: clean, at: Date.now() })); } catch { /* ignore */ }
  return clean.length;
}

// Refresh only if the cache is empty or older than this — keeps the list off the
// hot path. The manual Refresh button always forces a full refresh.
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Fetch only when stale; otherwise a no-op (no network). Never throws. */
export async function refreshServiceableIfStale(): Promise<void> {
  if (serviceableCount() > 0 && Date.now() - serviceableUpdatedAt() < TTL_MS) return;
  try { await refreshServiceablePincodes(); } catch { /* ignore — fail open */ }
}
