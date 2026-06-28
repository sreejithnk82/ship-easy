import { useEffect, useRef, useState } from 'react';

export type ScanFeedback = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

// Inline (embedded) camera barcode scanner. Continuously reads the tracking
// barcode (Code128) and forwards each new code to onDetected, which returns
// feedback shown over the video so the operator can keep scanning. ZXing is
// loaded on demand so it stays out of the main bundle. The camera stops when
// this component unmounts (e.g. switching back to the Type tab).
export const CameraScanner = ({ onDetected, height = 280 }: { onDetected: (text: string) => ScanFeedback; height?: number }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ text: string; t: number }>({ text: '', t: 0 });
  const attemptsRef = useRef(0);
  const [error, setError] = useState('');
  const [last, setLast] = useState<ScanFeedback>(null);
  // Diagnostics so we can tell "camera isn't decoding" apart from "decoding but
  // not matching", and whether the browser gave us a usable resolution.
  const [rawSeen, setRawSeen] = useState('');
  const [diag, setDiag] = useState<{ w: number; h: number; tries: number }>({ w: 0, h: 0, tries: 0 });

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
        // Our labels are Code128; accept a few sibling 1D formats too. TRY_HARDER
        // makes the decoder work harder per frame.
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        // delayBetweenScanAttempts: scan more often (default is 500ms) → more
        // chances to catch a sharp frame.
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          // Rear camera, HIGH resolution, continuous autofocus. Thin Code128 bars
          // need pixels — if the browser falls back to 640×480 they blur into one
          // another and never decode. focusMode isn't in the TS types yet → cast.
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 }, height: { ideal: 1080 },
              advanced: [{ focusMode: 'continuous' }],
            } as any,
          },
          videoRef.current,
          (result) => {
            attemptsRef.current += 1; // fires every frame, found or not
            if (!result) return;
            const text = result.getText();
            setRawSeen(text);
            const now = Date.now();
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

    // Surface the real capture resolution + attempt count once a second.
    const iv = setInterval(() => {
      const v = videoRef.current;
      setDiag({ w: v?.videoWidth || 0, h: v?.videoHeight || 0, tries: attemptsRef.current });
    }, 1000);

    return () => { cancelled = true; clearInterval(iv); try { controls?.stop(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height, background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline autoPlay />
      {!error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: '78%', maxWidth: 320, height: 96, border: '3px solid rgba(255,255,255,0.9)', borderRadius: 10 }} />
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: '1.25rem', textAlign: 'center', fontSize: '0.85rem', lineHeight: 1.5 }}>{error}</div>
      )}
      {/* Live decode readout — proves the camera is reading, and at what resolution. */}
      {!error && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: '0.3rem 0.6rem', background: 'rgba(0,0,0,0.55)', textAlign: 'center', fontSize: '0.72rem', fontFamily: 'monospace', color: rawSeen ? '#9ae6b4' : '#9ca3af' }}>
          {rawSeen ? `read: ${rawSeen}` : `scanning… ${diag.w}×${diag.h} · ${diag.tries} tries`}
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.6)', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem' }}>
        {last
          ? <span style={{ color: last.kind === 'ok' ? '#34d399' : last.kind === 'warn' ? '#fbbf24' : '#f87171' }}>{last.text}</span>
          : <span style={{ color: '#d1d5db', fontWeight: 400 }}>Fill the box with the barcode, ~15 cm away</span>}
      </div>
    </div>
  );
};

function cameraError(e: any): string {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission denied. Allow camera access for this site, then switch back to Camera.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera found on this device.';
  if (typeof location !== 'undefined' && location.protocol !== 'https:' && location.hostname !== 'localhost') return 'Camera needs a secure (https) connection.';
  return 'Could not start the camera: ' + (e?.message || String(e));
}
