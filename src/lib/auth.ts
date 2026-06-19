// Google Identity Services (GIS) sign-in for a cross-origin SPA.
//
// GIS mints a short-lived ID token (JWT) that the backend verifies on every
// call. We keep the latest token in memory + localStorage and hand it to the
// API client. ID tokens last ~1 hour; when one is near expiry we ask GIS for a
// fresh one (silent if the Google session is still active, otherwise the user
// re-signs in). This is the simple, dependency-free approach; it trades a
// possible hourly re-prompt for zero token-refresh plumbing.

import { GOOGLE_CLIENT_ID } from './config';

type Listener = (email: string | null) => void;

let idToken: string | null = null;
let tokenExp = 0; // unix seconds
let email: string | null = null;
let gisReady: Promise<void> | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
const listeners = new Set<Listener>();

const LS_KEY = 'shipeasy.idtoken';

function decodeJwt(token: string): any {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return {};
  }
}

function setToken(token: string) {
  idToken = token;
  const claims = decodeJwt(token);
  tokenExp = Number(claims.exp) || 0;
  email = claims.email || null;
  try { localStorage.setItem(LS_KEY, token); } catch {}
  listeners.forEach((l) => l(email));
}

function clearToken() {
  idToken = null;
  tokenExp = 0;
  email = null;
  try { localStorage.removeItem(LS_KEY); } catch {}
  listeners.forEach((l) => l(null));
}

function loadGis(): Promise<void> {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisReady;
}

function handleCredential(resp: { credential: string }) {
  setToken(resp.credential);
  if (pending) { pending.resolve(resp.credential); pending = null; }
}

/** Initialise GIS. Call once on app start. Restores a cached token if valid. */
export async function initAuth(onChange?: Listener): Promise<void> {
  if (onChange) listeners.add(onChange);
  const cached = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
  if (cached) {
    const exp = Number(decodeJwt(cached).exp) || 0;
    if (exp - 60 > Date.now() / 1000) setToken(cached);
    else { try { localStorage.removeItem(LS_KEY); } catch {} }
  }
  await loadGis();
  (window as any).google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredential,
    auto_select: true,
    use_fedcm_for_prompt: true,
  });
}

/** Render the official Google sign-in button into an element. */
export async function renderSignInButton(el: HTMLElement): Promise<void> {
  await initAuth();
  (window as any).google.accounts.id.renderButton(el, {
    theme: 'outline', size: 'large', shape: 'pill', width: 280, text: 'signin_with',
  });
  (window as any).google.accounts.id.prompt();
}

/** Return a valid ID token, refreshing via GIS if expired. Rejects if sign-in is needed. */
export async function ensureIdToken(): Promise<string> {
  if (idToken && Date.now() / 1000 < tokenExp - 60) return idToken;
  await initAuth();
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    (window as any).google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        if (pending) { pending.reject(new Error('NEEDS_LOGIN')); pending = null; }
      }
    });
  });
}

export function getEmail(): string | null { return email; }
export function isSignedIn(): boolean { return !!idToken && Date.now() / 1000 < tokenExp; }

export function signOut() {
  try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch {}
  clearToken();
}

export function onAuthChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
