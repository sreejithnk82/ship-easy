import { useSyncExternalStore, useEffect, useState, useRef } from 'react';
import { subscribeActivity, getActivitySnapshot } from '../lib/activity';

// A slim indeterminate bar pinned to the very top of the screen whenever a
// foreground backend request is in flight — the app-wide "something is
// happening" cue. Reads the module store directly (no provider needed); mounted
// once in main.tsx. The short hide delay keeps chained calls (e.g. save → reload)
// from flickering the bar off and on between them.
export function ActivityBar() {
  const count = useSyncExternalStore(subscribeActivity, getActivitySnapshot);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (count > 0) {
      setVisible(true);
    } else {
      hideTimer.current = window.setTimeout(() => { setVisible(false); hideTimer.current = null; }, 300);
    }
    return () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  }, [count]);

  if (!visible) return null;
  return <div className="activity-bar" role="progressbar" aria-label="Loading" aria-busy="true" />;
}
