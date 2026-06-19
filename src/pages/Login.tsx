import { useEffect, useRef } from 'react';
import { Package } from 'lucide-react';
import { renderSignInButton } from '../lib/auth';

export const Login = () => {
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (btnRef.current) {
      renderSignInButton(btnRef.current).catch((e) => console.error('Sign-in init failed', e));
    }
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-color)', padding: '1.5rem' }}>
      <div className="glass-card slide-up" style={{ textAlign: 'center', padding: '3.5rem 2rem', maxWidth: '450px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.1)' }}>
        <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--primary-color)', color: 'white', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto', boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3)' }}>
          <Package size={32} />
        </div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>ShipEasy</h2>
        <p style={{ marginBottom: '2.5rem', color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 500 }}>Transit & Shipping Management Portal</p>

        <div ref={btnRef} style={{ display: 'flex', justifyContent: 'center' }} />

        <p style={{ marginTop: '2.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Sign in with your authorised Google account to continue.
        </p>
      </div>
    </div>
  );
};
