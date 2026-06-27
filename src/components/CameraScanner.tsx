import { useEffect, useRef, useState } from 'react';
import { X, Camera } from 'lucide-react';

export type ScanFeedback = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

// Full-screen camera barcode scanner for phones. Continuously reads the tracking
// barcode (Code128) and forwards each new code to onDetected, which returns
// feedback to show in-frame so the operator can keep scanning without looking away.
// ZXing is loaded on demand (dynamic import) so it stays out of the main bundle.
export const CameraScanner = ({ onDetected, onClose }: { onDetected: (text: string) => ScanFeedback; onClose: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ text: string; t: number }>({ text: '', t: 0 });
  const [error, setError] = useState('');
  const [last, setLast] = useState<ScanFeedback>(null);

  useEffect(() => {
    let cancelled = false;
    let controls: { stop: () => void } | null = null;

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
        const reader = new BrowserMultiFormatReader(hints);
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const text = result.getText();
            const now = Date.now();
            // Ignore the same code seen repeatedly within 1.5s (continuous decode).
            if (text === lastRef.current.text && now - lastRef.current.t < 1500) return;
            lastRef.current = { text, t: now };
            const fb = onDetected(text);
            if (fb) {
              setLast(fb);
              if (fb.kind === 'ok') navigator.vibrate?.(80);
            }
          },
        );
      } catch (e: any) {
        if (!cancelled) setError(cameraError(e));
      }
    })();

    return () => { cancelled = true; try { controls?.stop(); } catch { /* ignore */ } };
    // onDetected reads live state via refs in ScanBook, so we intentionally start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 5000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', color: '#fff' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}><Camera size={18} /> Scan barcode</span>
        <button onClick={onClose} aria-label="Close camera" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={26} /></button>
      </div>

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
        {!error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: '80%', maxWidth: 360, height: 130, border: '3px solid rgba(255,255,255,0.9)', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} />
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: '2rem', textAlign: 'center', lineHeight: 1.5 }}>{error}</div>
        )}
      </div>

      <div style={{ minHeight: 56, padding: '0.85rem 1rem', background: '#111', color: '#fff', textAlign: 'center', fontWeight: 600 }}>
        {last
          ? <span style={{ color: last.kind === 'ok' ? '#34d399' : last.kind === 'warn' ? '#fbbf24' : '#f87171' }}>{last.text}</span>
          : <span style={{ color: '#9ca3af', fontWeight: 400 }}>Point the camera at a tracking barcode…</span>}
      </div>
    </div>
  );
};

function cameraError(e: any): string {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission denied. Allow camera access for this site, then reopen.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera found on this device.';
  if (typeof location !== 'undefined' && location.protocol !== 'https:' && location.hostname !== 'localhost') return 'Camera needs a secure (https) connection.';
  return 'Could not start the camera: ' + (e?.message || String(e));
}
