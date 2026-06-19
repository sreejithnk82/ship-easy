import { useState, useEffect } from 'react';
import {
  ShieldCheck, Building2, UserPlus, Hash, ExternalLink, Save, Truck,
  Pencil, Trash2, Pause, Play, ArrowRightLeft, X,
} from 'lucide-react';
import { api, Customer, UserRow, TrackingRange, HubCode, ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';

type Tab = 'customers' | 'users' | 'hubs' | 'ranges';
const TABS: { k: Tab; label: string }[] = [
  { k: 'customers', label: 'Customers' },
  { k: 'users', label: 'Users' },
  { k: 'hubs', label: 'Hub Codes' },
  { k: 'ranges', label: 'Tracking IDs' },
];

export const SuperAdmin = () => {
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hubCodes, setHubCodes] = useState<HubCode[]>([]);
  const [busy, setBusy] = useState(false);

  const [cust, setCust] = useState({ customerId: '', name: '', senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '', senderCity: '', senderState: '', senderPincode: '', senderEmail: '', hubCustomerCode: '' });
  const [user, setUser] = useState({ email: '', customerId: '', role: 'member' });
  const [newHub, setNewHub] = useState({ code: '', label: '' });

  // ranges
  const [rangeCustomer, setRangeCustomer] = useState('');
  const [ranges, setRanges] = useState<TrackingRange[]>([]);
  const [rangeForm, setRangeForm] = useState({ prefix: 'R', start: '', end: '', pad: '' });
  const [editRange, setEditRange] = useState<TrackingRange | null>(null);
  const [editForm, setEditForm] = useState({ prefix: '', start: '', end: '', pad: '' });
  const [reassign, setReassign] = useState<TrackingRange | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [{ customers }, { users }, { hubCodes }] = await Promise.all([api.listCustomers(), api.listUsers(), api.listHubCodes()]);
      setCustomers(customers); setUsers(users); setHubCodes(hubCodes);
    } catch (e: any) { alert('Load failed: ' + e.message); }
  };

  const createCustomer = async () => {
    if (!cust.customerId || !cust.name) { alert('Customer code and name are required.'); return; }
    setBusy(true);
    try {
      const res = await api.createCustomer(cust as any);
      alert(`Created ${cust.customerId}. Spreadsheet: ${res.spreadsheetUrl}`);
      setCust({ customerId: '', name: '', senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '', senderCity: '', senderState: '', senderPincode: '', senderEmail: '', hubCustomerCode: '' });
      load();
    } catch (e: any) { alert('Create failed: ' + e.message); } finally { setBusy(false); }
  };

  const addUser = async () => {
    if (!user.email) { alert('Email required.'); return; }
    if (user.role !== 'superadmin' && !user.customerId) { alert('Pick a customer for non-superadmins.'); return; }
    setBusy(true);
    try { await api.addUser(user); setUser({ email: '', customerId: '', role: 'member' }); load(); }
    catch (e: any) { alert('Add user failed: ' + e.message); } finally { setBusy(false); }
  };

  const addHubCode = async () => {
    if (!newHub.code.trim()) { alert('Hub customer code is required.'); return; }
    setBusy(true);
    try { await api.addHubCode(newHub.code.trim(), newHub.label.trim()); setNewHub({ code: '', label: '' }); load(); }
    catch (e: any) { alert('Add hub code failed: ' + e.message); } finally { setBusy(false); }
  };

  const loadRanges = async (customerId: string) => {
    setRangeCustomer(customerId);
    if (!customerId) { setRanges([]); return; }
    try { setRanges((await api.listTrackingRanges(customerId)).ranges); } catch { setRanges([]); }
  };

  const addRange = async () => {
    if (!rangeCustomer || !rangeForm.start || !rangeForm.end) { alert('Customer, start and end are required.'); return; }
    setBusy(true);
    try {
      await api.addTrackingRange(rangeCustomer, { prefix: rangeForm.prefix, start: Number(rangeForm.start), end: Number(rangeForm.end), pad: rangeForm.pad ? Number(rangeForm.pad) : undefined });
      setRangeForm({ prefix: rangeForm.prefix, start: '', end: '', pad: '' });
      loadRanges(rangeCustomer);
    } catch (e: any) { alert(rangeErr(e)); } finally { setBusy(false); }
  };

  const toggleStatus = async (r: TrackingRange) => {
    const next = r.status === 'paused' ? 'active' : 'paused';
    try { await api.updateTrackingRange(rangeCustomer, r.seq, { status: next }); loadRanges(rangeCustomer); }
    catch (e: any) { alert(rangeErr(e)); }
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
    } catch (e: any) { alert(rangeErr(e)); } finally { setBusy(false); }
  };

  const doDelete = async (r: TrackingRange) => {
    if (!window.confirm(`Delete range ${r.prefix}${r.start}–${r.prefix}${r.end}?`)) return;
    try { await api.deleteTrackingRange(rangeCustomer, r.seq); loadRanges(rangeCustomer); }
    catch (e: any) { alert(rangeErr(e)); }
  };

  const doReassign = async () => {
    if (!reassign || !reassignTo) return;
    setBusy(true);
    try {
      await api.reassignTrackingRange(rangeCustomer, reassignTo, reassign.seq);
      setReassign(null); setReassignTo('');
      loadRanges(rangeCustomer);
    } catch (e: any) { alert(rangeErr(e)); } finally { setBusy(false); }
  };

  if (profile?.role !== 'superadmin') return <div className="page-title">Superadmins only.</div>;

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

          <div className="glass-card">
            <h3 style={{ marginTop: 0 }}>Customers ({customers.length})</h3>
            {customers.map((c) => (
              <div key={c.customerId} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                <strong>{c.name}</strong> <span className="badge badge-gray">{c.customerId}</span>
                {c.spreadsheetId && <a href={`https://docs.google.com/spreadsheets/d/${c.spreadsheetId}`} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}><ExternalLink size={14} /></a>}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.senderCity} {c.senderPincode} · {c.hubCustomerCode}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* USERS */}
      {tab === 'users' && (
        <div className="glass-card" style={{ maxWidth: 560 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><UserPlus size={20} /> Add User</h3>
          <F label="Email *" v={user.email} on={(v) => setUser({ ...user, email: v })} />
          <div className="input-group">
            <label className="input-label">Role</label>
            <select className="input-field" value={user.role}
              onChange={(e) => setUser({ ...user, role: e.target.value, customerId: e.target.value === 'superadmin' ? '' : user.customerId })}>
              <option value="member">member</option><option value="admin">admin</option><option value="superadmin">superadmin</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Customer {user.role !== 'superadmin' ? '*' : '(optional)'}</label>
            <select className="input-field" value={user.customerId} disabled={user.role === 'superadmin'}
              onChange={(e) => setUser({ ...user, customerId: e.target.value })}
              style={user.role === 'superadmin' ? { opacity: 0.6 } : undefined}>
              <option value="">{user.role === 'superadmin' ? '— none (all customers) —' : '— choose a customer —'}</option>
              {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} ({c.customerId})</option>)}
            </select>
          </div>
          {user.role !== 'superadmin' && !user.customerId && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
              {user.role}s belong to one customer — pick the customer they'll work under.
            </p>
          )}
          <button className="btn btn-primary" onClick={addUser} disabled={busy || (user.role !== 'superadmin' && !user.customerId) || !user.email}><Save size={16} /> Add User</button>
          <h4 style={{ marginBottom: '0.5rem' }}>Users ({users.length})</h4>
          <div style={{ fontSize: '0.85rem' }}>
            {users.map((u) => <div key={u.email} style={{ padding: '0.2rem 0' }}>{u.email} — <strong>{u.role}</strong>{u.customerId ? ` · ${u.customerId}` : ''}</div>)}
          </div>
        </div>
      )}

      {/* HUB CODES */}
      {tab === 'hubs' && (
        <div className="glass-card" style={{ maxWidth: 560 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}><Truck size={20} /> Hub Customer Codes</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>Your DTDC account codes. Many customers can share one.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            <F label="Hub Code *" v={newHub.code} on={(v) => setNewHub({ ...newHub, code: v })} ph="OF2357C004" />
            <F label="Label" v={newHub.label} on={(v) => setNewHub({ ...newHub, label: v })} ph="optional" />
          </div>
          <button className="btn btn-primary" onClick={addHubCode} disabled={busy} style={{ marginTop: '0.5rem' }}><Save size={16} /> Add Hub Code</button>
          <div style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            {hubCodes.map((h) => <div key={h.code} style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)' }}><strong>{h.code}</strong>{h.label ? ` — ${h.label}` : ''}</div>)}
            {hubCodes.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No hub codes yet.</div>}
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
                {ranges.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No ranges for this customer yet.</div>}
              </div>
            </>
          )}
        </div>
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
