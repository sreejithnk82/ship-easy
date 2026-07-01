import { useState, useEffect } from 'react';
import {
  ShieldCheck, Building2, UserPlus, Hash, ExternalLink, Save, Truck,
  Pencil, Trash2, Pause, Play, ArrowRightLeft, X, Activity, Database, Archive,
} from 'lucide-react';
import { api, Customer, UserRow, TrackingRange, HubCode, Balance, Health, ApiError } from '../lib/api';
import { useProfile, isAdmin } from '../lib/profile';
import { useToast, useConfirm } from '../components/feedback';
import { istDayKey } from '../lib/datetime';

type Tab = 'customers' | 'users' | 'hubs' | 'ranges' | 'health';
const TABS: { k: Tab; label: string }[] = [
  { k: 'customers', label: 'Customers' },
  { k: 'users', label: 'Users' },
  { k: 'hubs', label: 'Hub Codes' },
  { k: 'ranges', label: 'Tracking IDs' },
  { k: 'health', label: 'Health' },
];

// Default archive cutoff: 12 months ago, as a yyyy-mm-dd (IST) string for <input type=date>.
function yearAgoISODate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return istDayKey(d);
}

export const SuperAdmin = () => {
  const profile = useProfile();
  const notify = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hubCodes, setHubCodes] = useState<HubCode[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [cust, setCust] = useState({ customerId: '', name: '', senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '', senderCity: '', senderState: '', senderPincode: '', senderEmail: '', hubCustomerCode: '' });
  const [editCust, setEditCust] = useState<Customer | null>(null);
  const [editCustForm, setEditCustForm] = useState({ name: '', senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '', senderCity: '', senderState: '', senderPincode: '', senderEmail: '', hubCustomerCode: '', status: '' });
  const [user, setUser] = useState({ email: '', customerId: '', role: 'member' });
  const [newHub, setNewHub] = useState({ code: '', label: '' });

  // ranges
  const [rangeCustomer, setRangeCustomer] = useState('');
  const [ranges, setRanges] = useState<TrackingRange[]>([]);
  const [loadingRanges, setLoadingRanges] = useState(false);
  const [rangeForm, setRangeForm] = useState({ prefix: 'R', start: '', end: '', pad: '' });
  const [editRange, setEditRange] = useState<TrackingRange | null>(null);
  const [editForm, setEditForm] = useState({ prefix: '', start: '', end: '', pad: '' });
  const [reassign, setReassign] = useState<TrackingRange | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  // health tab
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [healthCustomer, setHealthCustomer] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [archiveBefore, setArchiveBefore] = useState(yearAgoISODate());

  useEffect(() => { load(); }, []);

  useEffect(() => { if (tab === 'health' && balances === null) loadBalances(); }, [tab]);

  const loadBalances = async () => {
    try { setBalances((await api.listBalances()).balances); } catch (e: any) { notify('Balances failed: ' + e.message, 'error'); }
  };

  const loadHealth = async (customerId: string) => {
    setHealthCustomer(customerId); setHealth(null);
    if (!customerId) return;
    setLoadingHealth(true);
    try { setHealth(await api.customerHealth(customerId)); } catch (e: any) { notify('Health failed: ' + e.message, 'error'); }
    finally { setLoadingHealth(false); }
  };

  const doArchive = async () => {
    if (!healthCustomer) { notify('Pick a customer first.', 'error'); return; }
    if (!(await confirm({ title: 'Archive old orders', message: `Move shipped/cancelled orders before ${archiveBefore} into the archive sheet? Open orders are never touched.`, confirmLabel: 'Archive' }))) return;
    setBusy(true);
    try {
      const beforeISO = new Date(archiveBefore + 'T00:00:00+05:30').toISOString();
      const { moved } = await api.archiveOrders(healthCustomer, beforeISO);
      notify(`Archived ${moved} order(s).`, 'success');
      loadHealth(healthCustomer);
    } catch (e: any) { notify('Archive failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [{ customers }, { users }, { hubCodes }] = await Promise.all([api.listCustomers(), api.listUsers(), api.listHubCodes()]);
      setCustomers(customers); setUsers(users); setHubCodes(hubCodes);
    } catch (e: any) { notify('Load failed: ' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  const createCustomer = async () => {
    if (!cust.customerId || !cust.name) { notify('Customer code and name are required.', 'error'); return; }
    setBusy(true);
    try {
      const res = await api.createCustomer(cust as any);
      notify(`Created ${cust.customerId}. Spreadsheet: ${res.spreadsheetUrl}`, 'success');
      setCust({ customerId: '', name: '', senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '', senderCity: '', senderState: '', senderPincode: '', senderEmail: '', hubCustomerCode: '' });
      load();
    } catch (e: any) { notify('Create failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };

  const openEditCust = (c: Customer) => {
    setEditCust(c);
    setEditCustForm({
      name: c.name || '', senderName: c.senderName || '', senderPhone: c.senderPhone || '',
      senderAddr1: c.senderAddr1 || '', senderAddr2: c.senderAddr2 || '', senderCity: c.senderCity || '',
      senderState: c.senderState || '', senderPincode: c.senderPincode || '', senderEmail: c.senderEmail || '',
      hubCustomerCode: c.hubCustomerCode || '', status: c.status || 'active',
    });
  };

  const saveEditCust = async () => {
    if (!editCust) return;
    if (!editCustForm.name.trim()) { notify('Name is required.', 'error'); return; }
    setBusy(true);
    try {
      await api.updateCustomer(editCust.customerId, editCustForm);
      setEditCust(null);
      notify('Customer updated.', 'success');
      load();
    } catch (e: any) { notify('Update failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };

  const addUser = async () => {
    if (!user.email) { notify('Email required.', 'error'); return; }
    const needsGroup = user.role === 'member' || user.role === 'operator';
    if (needsGroup && !user.customerId) { notify('Pick a group for members/operators.', 'error'); return; }
    setBusy(true);
    try { await api.addUser(user); setUser({ email: '', customerId: '', role: 'member' }); load(); notify('User added.', 'success'); }
    catch (e: any) { notify('Add user failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };

  const addHubCode = async () => {
    if (!newHub.code.trim()) { notify('Hub customer code is required.', 'error'); return; }
    setBusy(true);
    try { await api.addHubCode(newHub.code.trim(), newHub.label.trim()); setNewHub({ code: '', label: '' }); load(); }
    catch (e: any) { notify('Add hub code failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };

  const loadRanges = async (customerId: string) => {
    setRangeCustomer(customerId);
    if (!customerId) { setRanges([]); return; }
    setLoadingRanges(true);
    try { setRanges((await api.listTrackingRanges(customerId)).ranges); } catch { setRanges([]); }
    finally { setLoadingRanges(false); }
  };

  const addRange = async () => {
    if (!rangeCustomer || !rangeForm.start || !rangeForm.end) { notify('Customer, start and end are required.', 'error'); return; }
    setBusy(true);
    try {
      await api.addTrackingRange(rangeCustomer, { prefix: rangeForm.prefix, start: Number(rangeForm.start), end: Number(rangeForm.end), pad: rangeForm.pad ? Number(rangeForm.pad) : undefined });
      setRangeForm({ prefix: rangeForm.prefix, start: '', end: '', pad: '' });
      loadRanges(rangeCustomer);
    } catch (e: any) { notify(rangeErr(e), 'error'); } finally { setBusy(false); }
  };

  const toggleStatus = async (r: TrackingRange) => {
    const next = r.status === 'paused' ? 'active' : 'paused';
    try { await api.updateTrackingRange(rangeCustomer, r.seq, { status: next }); loadRanges(rangeCustomer); }
    catch (e: any) { notify(rangeErr(e), 'error'); }
  };

  const openEdit = (r: TrackingRange) => {
    setEditRange(r);
    setEditForm({ prefix: r.prefix, start: String(r.start), end: String(r.end), pad: String(r.pad) });
  };

  const saveEdit = async () => {
    if (!editRange) return;
    setBusy(true);
    const payload = editRange.used
      ? { end: Number(editForm.end) }
      : { prefix: editForm.prefix, start: Number(editForm.start), end: Number(editForm.end), pad: editForm.pad ? Number(editForm.pad) : 0 };
    try {
      await api.updateTrackingRange(rangeCustomer, editRange.seq, payload);
      setEditRange(null);
      loadRanges(rangeCustomer);
    } catch (e: any) { notify(rangeErr(e), 'error'); } finally { setBusy(false); }
  };

  const doDelete = async (r: TrackingRange) => {
    if (!(await confirm({ title: 'Delete tracking range', message: <>Delete range <strong>{r.prefix}{r.start}–{r.prefix}{r.end}</strong>? This cannot be undone.</>, requireCode: true }))) return;
    try { await api.deleteTrackingRange(rangeCustomer, r.seq); loadRanges(rangeCustomer); }
    catch (e: any) { notify(rangeErr(e), 'error'); }
  };

  const doReassign = async () => {
    if (!reassign || !reassignTo) return;
    setBusy(true);
    try {
      await api.reassignTrackingRange(rangeCustomer, reassignTo, reassign.seq);
      setReassign(null); setReassignTo('');
      loadRanges(rangeCustomer);
    } catch (e: any) { notify(rangeErr(e), 'error'); } finally { setBusy(false); }
  };

  // Admins see Master Admin too, but read-only on the directory (Customers / Users /
  // Hub Codes). Only superadmins can create those. Tracking IDs + Health are full for both.
  const canWriteDirectory = profile?.role === 'superadmin';
  if (!isAdmin(profile)) return <div className="page-title">Admins only.</div>;

  return (
    <div className="fade-in" style={{ paddingBottom: '4rem' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <ShieldCheck size={28} style={{ color: 'var(--primary-color)' }} /> Master Admin
      </h1>

      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', marginBottom: '1.5rem', paddingBottom: '0.25rem' }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`btn ${tab === t.k ? 'btn-primary' : 'btn-outline'}`} style={{ whiteSpace: 'nowrap' }}>{t.label}</button>
        ))}
      </div>

      {/* CUSTOMERS */}
      {tab === 'customers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.5rem' }}>
          {canWriteDirectory && (
          <div className="glass-card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Building2 size={20} /> Create Customer</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              <F label="Customer Code *" v={cust.customerId} on={(v) => setCust({ ...cust, customerId: v })} ph="CUST001" />
              <F label="Name *" v={cust.name} on={(v) => setCust({ ...cust, name: v })} />
              <F label="Sender Name" v={cust.senderName} on={(v) => setCust({ ...cust, senderName: v })} />
              <F label="Sender Phone" v={cust.senderPhone} on={(v) => setCust({ ...cust, senderPhone: v })} />
              <F label="City" v={cust.senderCity} on={(v) => setCust({ ...cust, senderCity: v })} />
              <F label="State" v={cust.senderState} on={(v) => setCust({ ...cust, senderState: v })} />
              <F label="Pincode" v={cust.senderPincode} on={(v) => setCust({ ...cust, senderPincode: v })} />
              <F label="Sender Email" v={cust.senderEmail} on={(v) => setCust({ ...cust, senderEmail: v })} />
              <div className="input-group" style={{ margin: 0 }}>
                <label className="input-label">Default Hub Code</label>
                <select className="input-field" value={cust.hubCustomerCode} onChange={(e) => setCust({ ...cust, hubCustomerCode: e.target.value })}>
                  <option value="">— choose —</option>
                  {hubCodes.map((h) => <option key={h.code} value={h.code}>{h.code}{h.label ? ` (${h.label})` : ''}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={createCustomer} disabled={busy} style={{ marginTop: '1rem' }}><Save size={16} /> Create</button>
          </div>
          )}

          <div className="glass-card">
            <h3 style={{ marginTop: 0 }}>Customers ({customers.length})</h3>
            {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
            {!loading && customers.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No customers yet.</p>}
            {customers.map((c) => (
              <div key={c.customerId} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{c.name}</strong> <span className="badge badge-gray">{c.customerId}</span>
                  {c.status && c.status !== 'active' && <span className="badge badge-processing" style={{ marginLeft: 4 }}>{c.status}</span>}
                  {c.spreadsheetId && <a href={`https://docs.google.com/spreadsheets/d/${c.spreadsheetId}`} target="_blank" rel="noreferrer" title="Open sheet" style={{ marginLeft: 8 }}><ExternalLink size={14} /></a>}
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.senderCity} {c.senderPincode} · {c.hubCustomerCode}</div>
                </div>
                {canWriteDirectory && (
                  <button title="Edit details" onClick={() => openEditCust(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', padding: '0.25rem' }}><Pencil size={16} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* USERS */}
      {tab === 'users' && (() => {
        // admin & superadmin are global (no single group); member & operator need a group.
        const userIsGlobal = user.role === 'superadmin' || user.role === 'admin';
        return (
        <div className="glass-card" style={{ maxWidth: 560 }}>
          {canWriteDirectory && (<>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><UserPlus size={20} /> Add User</h3>
          <F label="Email *" v={user.email} on={(v) => setUser({ ...user, email: v })} />
          <div className="input-group">
            <label className="input-label">Role</label>
            <select className="input-field" value={user.role}
              onChange={(e) => setUser({ ...user, role: e.target.value, customerId: (e.target.value === 'superadmin' || e.target.value === 'admin') ? '' : user.customerId })}>
              <option value="member">member</option><option value="admin">admin</option><option value="operator">operator</option><option value="superadmin">superadmin</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Group {userIsGlobal ? '(optional)' : '*'}</label>
            <select className="input-field" value={user.customerId} disabled={userIsGlobal}
              onChange={(e) => setUser({ ...user, customerId: e.target.value })}
              style={userIsGlobal ? { opacity: 0.6 } : undefined}>
              <option value="">{userIsGlobal ? '— none (all groups) —' : '— choose a group —'}</option>
              {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
            </select>
          </div>
          {!userIsGlobal && !user.customerId && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
              {user.role}s belong to one group — pick the group they'll work under.
            </p>
          )}
          <button className="btn btn-primary" onClick={addUser} disabled={busy || (!userIsGlobal && !user.customerId) || !user.email}><Save size={16} /> Add User</button>
          </>)}
          <h4 style={{ marginBottom: '0.5rem' }}>Users ({users.length})</h4>
          <div style={{ fontSize: '0.85rem' }}>
            {loading && <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>}
            {!loading && users.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No users yet.</div>}
            {(() => {
              const custName = new Map(customers.map((c) => [c.customerId, c.name]));
              const groupOf = (u: UserRow) => (u.customerId ? (custName.get(u.customerId) || u.customerId) : 'All groups');
              const roleClass = (r: string) => (r === 'superadmin' || r === 'admin' ? 'badge-primary' : r === 'operator' ? 'badge-processing' : 'badge-gray');
              const sorted = [...users].sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || a.email.localeCompare(b.email));
              return sorted.map((u) => (
                <div key={u.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {groupOf(u)}{u.status && u.status !== 'active' ? ` · ${u.status}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${roleClass(u.role)}`} style={{ textTransform: 'capitalize', flex: '0 0 auto' }}>{u.role}</span>
                </div>
              ));
            })()}
          </div>
        </div>
        );
      })()}

      {/* HUB CODES */}
      {tab === 'hubs' && (
        <div className="glass-card" style={{ maxWidth: 560 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Truck size={20} /> Hub Customer Codes</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>Your DTDC account codes. Many customers can share one.</p>
          {canWriteDirectory && (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            <F label="Hub Code *" v={newHub.code} on={(v) => setNewHub({ ...newHub, code: v })} ph="OF2357C004" />
            <F label="Label" v={newHub.label} on={(v) => setNewHub({ ...newHub, label: v })} ph="optional" />
          </div>
          <button className="btn btn-primary" onClick={addHubCode} disabled={busy} style={{ marginTop: '0.5rem' }}><Save size={16} /> Add Hub Code</button>
          </>)}
          <div style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            {loading && <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>}
            {hubCodes.map((h) => <div key={h.code} style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)' }}><strong>{h.code}</strong>{h.label ? ` — ${h.label}` : ''}</div>)}
            {!loading && hubCodes.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No hub codes yet.</div>}
          </div>
        </div>
      )}

      {/* TRACKING IDS */}
      {tab === 'ranges' && (
        <div className="glass-card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Hash size={20} /> Tracking ID Ranges</h3>
          <div className="input-group">
            <label className="input-label">Customer</label>
            <select className="input-field" value={rangeCustomer} onChange={(e) => loadRanges(e.target.value)}>
              <option value="">— choose a customer —</option>
              {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
            </select>
          </div>

          {rangeCustomer && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '0.5rem' }}>
                <F label="Prefix" v={rangeForm.prefix} on={(v) => setRangeForm({ ...rangeForm, prefix: v })} />
                <F label="Start *" v={rangeForm.start} on={(v) => setRangeForm({ ...rangeForm, start: v })} />
                <F label="End *" v={rangeForm.end} on={(v) => setRangeForm({ ...rangeForm, end: v })} />
                <F label="Pad" v={rangeForm.pad} on={(v) => setRangeForm({ ...rangeForm, pad: v })} ph="auto" />
              </div>
              <button className="btn btn-primary" onClick={addRange} disabled={busy} style={{ marginTop: '0.5rem' }}><Save size={16} /> Add Range</button>

              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {loadingRanges && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading…</div>}
                {ranges.map((r) => (
                  <div key={r.seq} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{r.prefix}{r.start} – {r.prefix}{r.end}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {r.allocated} issued · {r.remaining} left
                          {' '}<span className={`badge ${r.status === 'active' ? 'badge-completed' : r.status === 'paused' ? 'badge-processing' : 'badge-gray'}`}>{r.status}</span>
                          {r.used && <span className="badge badge-gray" style={{ marginLeft: 4 }}>in use</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <IconBtn title={r.status === 'paused' ? 'Resume' : 'Pause'} color="var(--warning-color)" onClick={() => toggleStatus(r)}>
                          {r.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                        </IconBtn>
                        <IconBtn title="Edit" color="var(--primary-color)" onClick={() => openEdit(r)}><Pencil size={16} /></IconBtn>
                        <IconBtn title={r.used ? 'Issued IDs — cannot reassign' : 'Reassign'} color="var(--primary-color)" disabled={r.used} onClick={() => { setReassign(r); setReassignTo(''); }}><ArrowRightLeft size={16} /></IconBtn>
                        <IconBtn title={r.used ? 'Issued IDs — cannot delete' : 'Delete'} color="var(--danger-color)" disabled={r.used} onClick={() => doDelete(r)}><Trash2 size={16} /></IconBtn>
                      </div>
                    </div>
                  </div>
                ))}
                {!loadingRanges && ranges.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No ranges for this customer yet.</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* HEALTH */}
      {tab === 'health' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1.5rem' }}>
          <div className="glass-card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Activity size={20} /> Tracking ID Balances</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>Customers low on IDs are flagged — top up their ranges before they run out.</p>
            {balances === null ? <p style={{ color: 'var(--text-secondary)' }}>Loading…</p> : (
              <div style={{ fontSize: '0.9rem' }}>
                {[...balances].sort((a, b) => a.remaining - b.remaining).map((b) => (
                  <div key={b.customerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    <span>{b.name} <span className="badge badge-gray">{b.customerId}</span></span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong>{b.remaining < 0 ? '—' : b.remaining}</strong>
                      {b.low && <span className="badge badge-processing">LOW</span>}
                    </span>
                  </div>
                ))}
                {balances.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No customers yet.</div>}
              </div>
            )}
          </div>

          <div className="glass-card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Database size={20} /> Storage & Archive</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>Google Sheets caps each customer at 10M cells. Archive old shipped/cancelled orders to keep the live sheet fast and well under the limit.</p>
            <div className="input-group">
              <label className="input-label">Customer</label>
              <select className="input-field" value={healthCustomer} onChange={(e) => loadHealth(e.target.value)}>
                <option value="">— choose a customer —</option>
                {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
              </select>
            </div>
            {loadingHealth && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
            {health && (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
                  <span className="badge badge-gray">{health.orderRows.toLocaleString()} order rows</span>
                  <span className="badge badge-gray">{health.orderCells.toLocaleString()} cells</span>
                  <span className={`badge ${health.warn ? 'badge-processing' : 'badge-completed'}`}>{health.pctOfLimit}% of limit</span>
                </div>
                <div className="input-group">
                  <label className="input-label">Archive orders shipped/cancelled before</label>
                  <input className="input-field" type="date" value={archiveBefore} onChange={(e) => setArchiveBefore(e.target.value)} />
                </div>
                <button className="btn btn-outline" onClick={doArchive} disabled={busy}><Archive size={16} /> {busy ? 'Archiving…' : 'Archive old orders'}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit customer modal */}
      {editCust && (
        <Modal title={`Edit ${editCust.name}`} onClose={() => setEditCust(null)}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>
            Customer code <span className="badge badge-gray">{editCust.customerId}</span> can't be changed — it links users, the spreadsheet and tracking IDs.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
            <F label="Name *" v={editCustForm.name} on={(v) => setEditCustForm({ ...editCustForm, name: v })} />
            <F label="Sender Name" v={editCustForm.senderName} on={(v) => setEditCustForm({ ...editCustForm, senderName: v })} />
            <F label="Sender Phone" v={editCustForm.senderPhone} on={(v) => setEditCustForm({ ...editCustForm, senderPhone: v })} />
            <F label="Address 1" v={editCustForm.senderAddr1} on={(v) => setEditCustForm({ ...editCustForm, senderAddr1: v })} />
            <F label="Address 2" v={editCustForm.senderAddr2} on={(v) => setEditCustForm({ ...editCustForm, senderAddr2: v })} />
            <F label="City" v={editCustForm.senderCity} on={(v) => setEditCustForm({ ...editCustForm, senderCity: v })} />
            <F label="State" v={editCustForm.senderState} on={(v) => setEditCustForm({ ...editCustForm, senderState: v })} />
            <F label="Pincode" v={editCustForm.senderPincode} on={(v) => setEditCustForm({ ...editCustForm, senderPincode: v })} />
            <F label="Sender Email" v={editCustForm.senderEmail} on={(v) => setEditCustForm({ ...editCustForm, senderEmail: v })} />
            <div className="input-group" style={{ margin: '0 0 0.6rem' }}>
              <label className="input-label">Default Hub Code</label>
              <select className="input-field" value={editCustForm.hubCustomerCode} onChange={(e) => setEditCustForm({ ...editCustForm, hubCustomerCode: e.target.value })}>
                <option value="">— choose —</option>
                {hubCodes.map((h) => <option key={h.code} value={h.code}>{h.code}{h.label ? ` (${h.label})` : ''}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ margin: '0 0 0.6rem' }}>
              <label className="input-label">Status</label>
              <select className="input-field" value={editCustForm.status} onChange={(e) => setEditCustForm({ ...editCustForm, status: e.target.value })}>
                <option value="active">active</option>
                <option value="paused">paused</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditCust(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveEditCust} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {/* Edit range modal */}
      {editRange && (
        <Modal title={`Edit range (seq ${editRange.seq})`} onClose={() => setEditRange(null)}>
          {editRange.used && <p style={{ fontSize: '0.85rem', color: 'var(--warning-color)' }}>{editRange.allocated} IDs already issued — only the <strong>end</strong> can be extended.</p>}
          <F label="Prefix" v={editForm.prefix} on={(v) => setEditForm({ ...editForm, prefix: v })} disabled={editRange.used} />
          <F label="Start" v={editForm.start} on={(v) => setEditForm({ ...editForm, start: v })} disabled={editRange.used} />
          <F label="End" v={editForm.end} on={(v) => setEditForm({ ...editForm, end: v })} />
          <F label="Pad" v={editForm.pad} on={(v) => setEditForm({ ...editForm, pad: v })} disabled={editRange.used} />
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditRange(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveEdit} disabled={busy}>Save</button>
          </div>
        </Modal>
      )}

      {/* Reassign modal */}
      {reassign && (
        <Modal title="Reassign range" onClose={() => setReassign(null)}>
          <p style={{ fontSize: '0.9rem' }}>Move <strong>{reassign.prefix}{reassign.start}–{reassign.prefix}{reassign.end}</strong> to another customer.</p>
          <div className="input-group">
            <label className="input-label">Target customer</label>
            <select className="input-field" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">— choose —</option>
              {customers.filter((c) => c.customerId !== rangeCustomer).map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setReassign(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={doReassign} disabled={busy || !reassignTo}>Reassign</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

function rangeErr(e: any): string {
  if (e instanceof ApiError) {
    if (e.code === 'RANGE_IN_USE') return 'Blocked: ' + (e.detail || 'IDs already issued from this range.');
    if (e.code === 'OVERLAP') return 'Blocked: ' + (e.detail || 'range overlaps an existing one.');
    if (e.code === 'BAD_RANGE') return 'Invalid range: ' + (e.detail || 'end must be ≥ start.');
  }
  return 'Failed: ' + (e?.message || e);
}

const F = ({ label, v, on, ph, type = 'text', disabled }: { label: string; v: string; on: (v: string) => void; ph?: string; type?: string; disabled?: boolean }) => (
  <div className="input-group" style={{ margin: '0 0 0.6rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" type={type} value={v} placeholder={ph} disabled={disabled} onChange={(e) => on(e.target.value)} style={disabled ? { opacity: 0.6 } : undefined} />
  </div>
);

const IconBtn = ({ children, title, color, onClick, disabled }: { children: any; title: string; color: string; onClick: () => void; disabled?: boolean }) => (
  <button title={title} onClick={onClick} disabled={disabled} style={{ background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', color, opacity: disabled ? 0.3 : 1, padding: '0.25rem' }}>{children}</button>
);

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: any }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
    <div className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 420, background: 'white', maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
      </div>
      {children}
    </div>
  </div>
);
