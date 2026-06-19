import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export const ReloadPrompt = () => {
  let swResult: any = { offlineReady: [false, () => {}], needUpdate: [false, () => {}], updateServiceWorker: () => {} };
  
  try {
    const sw = useRegisterSW({
      onRegistered() { console.log('SW Registered'); },
      onRegisterError(error) { console.log('SW Error', error); },
    });
    if (sw) swResult = sw;
  } catch (e) {
    console.error('PWA Hook Error:', e);
  }

  // Safe Extraction
  const offlineReadyState = swResult?.offlineReady || [false, () => {}];
  const needUpdateState = swResult?.needUpdate || [false, () => {}];
  
  const [offlineReady, setOfflineReady] = offlineReadyState;
  const [needUpdate, setNeedUpdate] = needUpdateState;
  const updateServiceWorker = swResult?.updateServiceWorker || (() => {});

  const close = () => {
    setOfflineReady(false);
    setNeedUpdate(false);
  };

  if (!offlineReady && !needUpdate) return null;

  return (
    <div className="reload-prompt-container slide-up">
      <div className="glass-card reload-prompt-card">
        <div className="reload-prompt-content">
          <div className="reload-icon-wrapper">
             <RefreshCw size={24} className={needUpdate ? 'spin' : ''} />
          </div>
          <div className="reload-text">
            {offlineReady ? (
              <>
                <h4 style={{ margin: 0 }}>App Ready</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Ready to work offline</p>
              </>
            ) : (
              <>
                <h4 style={{ margin: 0 }}>Update Available</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>New version is ready to install</p>
              </>
            )}
          </div>
        </div>
        <div className="reload-prompt-actions">
          {needUpdate && (
            <button className="btn btn-primary" onClick={() => updateServiceWorker(true)}>
              Update Now
            </button>
          )}
          <button className="btn btn-outline" onClick={() => close()} style={{ padding: '0.75rem' }}>
            <X size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
