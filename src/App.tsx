import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Package, PackagePlus, ScanLine, LogOut, ShieldCheck, MapPin, History as HistoryIcon } from 'lucide-react';
import { initAuth, onAuthChange, getEmail, signOut } from './lib/auth';
import { api, Profile, Customer } from './lib/api';
import { ApiError } from './lib/api';
import { ProfileContext, isOperator, canScan } from './lib/profile';
import { ActiveCustomerContext, ACTIVE_CUSTOMER_KEY } from './lib/activeCustomer';
import { Login } from './pages/Login';
import { AddOrder } from './pages/AddOrder';
import { Products } from './pages/Products';
import { ScanBook } from './pages/ScanBook';
import { History } from './pages/History';
import { Addresses } from './pages/Addresses';
import { SuperAdmin } from './pages/SuperAdmin';
import { ContactAdmin } from './pages/ContactAdmin';
import { ReloadPrompt } from './ReloadPrompt';

const Brand = () => (
  <div className="sidebar-logo"><Package size={26} /> ShipEasy</div>
);

const NavItems = ({ profile }: { profile: Profile | null }) => (
  <>
    {!isOperator(profile) && (
      <NavLink to="/book" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <PackagePlus size={20} /> Book Orders
      </NavLink>
    )}
    {!isOperator(profile) && (
      <NavLink to="/products" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <Package size={20} /> Products
      </NavLink>
    )}
    {!isOperator(profile) && (
      <NavLink to="/history" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <HistoryIcon size={20} /> Label History
      </NavLink>
    )}
    {profile?.role === 'superadmin' && (
      <NavLink to="/addresses" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <MapPin size={20} /> Addresses
      </NavLink>
    )}
    {canScan(profile) && (
      <NavLink to="/scan" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <ScanLine size={20} /> Scan &amp; Book
      </NavLink>
    )}
    {profile?.role === 'superadmin' && (
      <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} style={{ color: 'var(--primary-color)' }}>
        <ShieldCheck size={20} /> Master Admin
      </NavLink>
    )}
  </>
);

const Layout = ({ profile, children, switcher }: { profile: Profile | null; children: React.ReactNode; switcher?: React.ReactNode }) => (
  <div className="app-layout">
    <header className="top-navbar"><Brand /></header>
    <aside className="sidebar">
      <Brand />
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <NavItems profile={profile} />
      </nav>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0 1rem 0.5rem' }}>{getEmail()}</div>
        <button className="nav-link" onClick={signOut} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-secondary)' }}>
          <LogOut size={20} /> Logout
        </button>
      </div>
    </aside>
    <main className="main-content"><div className="slide-up">{switcher}{children}</div></main>
    <nav className="bottom-nav">
      {!isOperator(profile) && (
        <NavLink to="/book" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}><PackagePlus size={22} /><span>Book</span></NavLink>
      )}
      {!isOperator(profile) && (
        <NavLink to="/products" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}><Package size={22} /><span>Items</span></NavLink>
      )}
      {!isOperator(profile) && (
        <NavLink to="/history" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}><HistoryIcon size={22} /><span>History</span></NavLink>
      )}
      {canScan(profile) && (
        <NavLink to="/scan" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}><ScanLine size={22} /><span>Scan</span></NavLink>
      )}
      {profile?.role === 'superadmin' && (
        <NavLink to="/admin" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}><ShieldCheck size={22} /><span>Admin</span></NavLink>
      )}
    </nav>
  </div>
);

const Splash = ({ text }: { text: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
    <div className="pulse" style={{ width: 72, height: 72, background: 'var(--primary-color)', color: 'white', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
      <Package size={36} />
    </div>
    <p style={{ color: 'var(--text-secondary)' }}>{text}</p>
  </div>
);

const App = () => {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(getEmail());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeId, setActiveIdState] = useState<string>(() => {
    try { return localStorage.getItem(ACTIVE_CUSTOMER_KEY) || ''; } catch { return ''; }
  });
  const setActiveId = (id: string) => {
    setActiveIdState(id);
    try { localStorage.setItem(ACTIVE_CUSTOMER_KEY, id); } catch { /* ignore */ }
  };

  useEffect(() => {
    const unsub = onAuthChange(setEmail);
    initAuth().finally(() => setReady(true));
    return unsub;
  }, []);

  // Superadmins act on a chosen customer — load the list for the switcher.
  useEffect(() => {
    if (profile?.role === 'superadmin') {
      api.listCustomers().then(({ customers }) => setCustomers(customers)).catch(() => { /* ignore */ });
    }
  }, [profile?.role]);

  useEffect(() => {
    if (!email) { setProfile(null); setProfileErr(null); return; }
    let active = true;
    setLoadingProfile(true);
    api.getProfile()
      .then((p) => { if (active) { setProfile(p); setProfileErr(null); } })
      .catch((e) => { if (active) { setProfile(null); setProfileErr(e instanceof ApiError ? e.code : (e as Error).message); } })
      .finally(() => { if (active) setLoadingProfile(false); });
    return () => { active = false; };
  }, [email]);

  if (!ready) return <Splash text="Starting…" />;
  if (!email) return <Login />;
  if (loadingProfile) return <Splash text="Loading your workspace…" />;
  if (profileErr === 'NO_ACCOUNT' || (!profile && profileErr)) {
    return <ContactAdmin errorMsg={profileErr === 'NO_ACCOUNT' ? null : profileErr} />;
  }
  if (!profile?.customerId && profile?.role !== 'superadmin') {
    return <ContactAdmin errorMsg={null} />;
  }

  const showSwitcher = profile?.role === 'superadmin' && !profile.customerId;
  const switcher = showSwitcher ? (
    <div className="glass-card" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Acting as customer:</span>
      <select className="input-field" value={activeId} onChange={(e) => setActiveId(e.target.value)} style={{ maxWidth: 320, width: 'auto', flex: 1 }}>
        <option value="">— select a customer —</option>
        {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
      </select>
    </div>
  ) : null;

  return (
    <ProfileContext.Provider value={profile}>
      <ActiveCustomerContext.Provider value={{ activeId, setActiveId }}>
        <HashRouter>
          <ReloadPrompt />
          {isOperator(profile) ? (
            // Operators are scoped to the Scan page only; everything else redirects.
            <Routes>
              <Route path="/scan" element={<Layout profile={profile}><ScanBook /></Layout>} />
              <Route path="*" element={<Navigate to="/scan" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/book" element={<Layout profile={profile} switcher={switcher}><AddOrder /></Layout>} />
              <Route path="/products" element={<Layout profile={profile} switcher={switcher}><Products /></Layout>} />
              <Route path="/history" element={<Layout profile={profile} switcher={switcher}><History /></Layout>} />
              <Route path="/addresses" element={<Layout profile={profile} switcher={switcher}><Addresses /></Layout>} />
              <Route path="/scan" element={<Layout profile={profile} switcher={switcher}><ScanBook /></Layout>} />
              <Route path="/admin" element={<Layout profile={profile}><SuperAdmin /></Layout>} />
              <Route path="*" element={<Navigate to="/book" replace />} />
            </Routes>
          )}
        </HashRouter>
      </ActiveCustomerContext.Provider>
    </ProfileContext.Provider>
  );
};

export default App;
