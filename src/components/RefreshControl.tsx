import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { refreshServiceablePincodes } from '../lib/serviceable';
import { checkAppUpdate } from '../lib/pwa';
import { useToast } from './feedback';

// One button that does both jobs the operator cares about: pull the latest
// serviceable-pincode list AND grab the newest app version. If a new version is
// found the page reloads itself; otherwise we just confirm we're up to date.
export const RefreshControl = ({ variant = 'nav' }: { variant?: 'nav' | 'icon' }) => {
  const notify = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    let count = -1;
    try { count = await refreshServiceablePincodes(); } catch { /* offline / not set up yet */ }
    try {
      const res = await checkAppUpdate();
      if (res === 'updating') { notify('New version found — updating…', 'success'); return; } // reload incoming
    } catch { /* ignore */ }
    notify(count >= 0 ? `Up to date · ${count} serviceable pincodes loaded.` : 'Up to date.', 'success');
    setBusy(false);
  };

  if (variant === 'icon') {
    return (
      <button title="Refresh data & app" onClick={run} disabled={busy}
        style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--text-secondary)', padding: '0.35rem', display: 'inline-flex' }}>
        <RefreshCw size={20} className={busy ? 'spin' : ''} />
      </button>
    );
  }

  return (
    <button className="nav-link" onClick={run} disabled={busy}
      style={{ width: '100%', background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', textAlign: 'left', color: 'var(--text-secondary)' }}>
      <RefreshCw size={20} className={busy ? 'spin' : ''} /> {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  );
};
