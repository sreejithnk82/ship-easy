// Public runtime config, injected at build time from .env (see .env.example).

export const WEBAPP_URL = (import.meta.env.VITE_WEBAPP_URL as string) || '';
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';

if (!WEBAPP_URL) console.warn('VITE_WEBAPP_URL is not set — API calls will fail.');
if (!GOOGLE_CLIENT_ID) console.warn('VITE_GOOGLE_CLIENT_ID is not set — sign-in will fail.');
