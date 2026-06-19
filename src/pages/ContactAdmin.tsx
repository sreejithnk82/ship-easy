import { signOut } from '../lib/auth';
import { Mail, LogOut, ShieldAlert } from 'lucide-react';

export const ContactAdmin = ({ errorMsg }: { errorMsg?: string | null }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-color)' }}>
      <div className="glass-card" style={{ textAlign: 'center', padding: '3rem', minWidth: '350px', maxWidth: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', color: 'var(--danger-color)' }}>
          <ShieldAlert size={64} />
        </div>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Access Denied</h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          Your account is not linked to any active organization in the ShipEasy network. 
          Please contact your Super Admin to receive an official invite.
        </p>
        
        {errorMsg && (
          <div style={{ padding: '1rem', marginBottom: '2rem', backgroundColor: 'rgba(255,50,50,0.1)', border: '1px solid var(--danger-color)', borderRadius: '0.5rem', color: 'var(--danger-color)', fontSize: '0.875rem' }}>
            <strong>Debug Error:</strong> {errorMsg}
          </div>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button 
            className="btn btn-primary" 
            onClick={() => window.location.href = "mailto:admin@shipeasy.com"} 
            style={{ width: '100%', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem' }}
          >
            <Mail size={20} />
            <span>Contact Admin</span>
          </button>
          
          <button 
            className="btn" 
            onClick={() => { signOut(); window.location.reload(); }}
            style={{ width: '100%', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          >
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
