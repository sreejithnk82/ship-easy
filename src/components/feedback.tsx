import { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

// In-app replacements for the browser's alert()/confirm() boxes.
//   • ToastProvider  → useToast(): notify(message, kind) — transient, auto-dismiss.
//   • ConfirmProvider → useConfirm(): confirm(opts) → Promise<boolean>.
// Both are mounted once at the app root (main.tsx); pages just call the hooks.

/* ------------------------------- toasts ------------------------------- */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: ReactNode; kind: ToastKind; }

const ToastCtx = createContext<(message: ReactNode, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

const TOAST_STYLE: Record<ToastKind, { bg: string; accent: string; icon: ReactNode }> = {
  success: { bg: '#ecfdf5', accent: '#10b981', icon: <CheckCircle size={18} /> },
  error: { bg: '#fef2f2', accent: '#ef4444', icon: <AlertTriangle size={18} /> },
  info: { bg: '#eef2ff', accent: '#6366f1', icon: <Info size={18} /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((message: ReactNode, kind: ToastKind = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => remove(id), 4500);
  }, [remove]);

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 6000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', pointerEvents: 'none' }}>
        {toasts.map((t) => {
          const s = TOAST_STYLE[t.kind];
          return (
            <div
              key={t.id}
              className="slide-up"
              onClick={() => remove(t.id)}
              style={{ pointerEvents: 'auto', cursor: 'pointer', width: '100%', maxWidth: 420, display: 'flex', alignItems: 'flex-start', gap: '0.6rem', background: s.bg, borderLeft: `4px solid ${s.accent}`, color: '#1f2937', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.9rem', boxShadow: '0 6px 24px rgba(0,0,0,0.15)', fontSize: '0.9rem' }}
            >
              <span style={{ color: s.accent, display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
              <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{t.message}</span>
              <X size={16} style={{ flexShrink: 0, opacity: 0.5 }} />
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------ confirm ------------------------------- */

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  requireCode?: boolean; // make the user type a random 3-digit code (destructive deletes)
  danger?: boolean;      // red styling (implied when requireCode)
}
interface ConfirmState extends ConfirmOptions { code: string; }

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [input, setInput] = useState('');
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    const code = opts.requireCode ? String(Math.floor(100 + Math.random() * 900)) : ''; // 100–999
    setInput('');
    setState({ ...opts, code });
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const finish = (result: boolean) => {
    setState(null);
    setInput('');
    const r = resolver.current;
    resolver.current = null;
    r?.(result);
  };

  const needCode = !!state?.requireCode;
  const matched = !needCode || (!!state && input === state.code);
  const danger = state ? (state.danger ?? state.requireCode ?? false) : false;

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => finish(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="slide-up"
            style={{ background: 'white', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 360, padding: '1.25rem', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <span style={{ display: 'inline-flex', color: danger ? 'var(--danger-color)' : 'var(--primary-color)' }}>
                {danger ? <AlertTriangle size={22} /> : <Info size={22} />}
              </span>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{state.title || 'Please confirm'}</h3>
              <button onClick={() => finish(false)} aria-label="Cancel" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={20} /></button>
            </div>

            <div style={{ fontSize: '0.9rem', marginBottom: '1rem', whiteSpace: 'pre-line' }}>{state.message}</div>

            {needCode && (
              <>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>
                  Type <strong style={{ fontSize: '1.3rem', letterSpacing: '0.18em', color: 'var(--primary-color)' }}>{state.code}</strong> to confirm:
                </p>
                <input
                  autoFocus
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  className="input-field"
                  value={input}
                  onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && matched) finish(true); }}
                  placeholder="000"
                  style={{ fontSize: '1.4rem', textAlign: 'center', letterSpacing: '0.3em', marginBottom: '1.1rem' }}
                />
              </>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => finish(false)}>Cancel</button>
              <button
                className="btn"
                disabled={!matched}
                onClick={() => finish(true)}
                style={{ flex: 1, background: !matched ? '#cbd5e1' : danger ? 'var(--danger-color)' : 'var(--primary-color)', color: 'white', border: 'none', cursor: matched ? 'pointer' : 'not-allowed' }}
              >
                {state.confirmLabel || (danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
