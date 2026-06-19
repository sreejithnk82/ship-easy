import { useState, useEffect, useRef } from 'react';
import { ScanLine, FileSpreadsheet, Truck, Check, AlertTriangle, X, Pencil } from 'lucide-react';
import { api, Product, OpenOrder } from '../lib/api';
import { useProfile, isAdmin } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { downloadDtdc, DtdcOrder } from '../lib/dtdc';
import { stateFromPincode } from '../lib/pincode';

type Flash = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

export const ScanBook = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;

  const [openMap, setOpenMap] = useState<Map<string, OpenOrder>>(new Map());
  const [products, setProducts] = useState<Product[]>([]);
  const [scanned, setScanned] = useState<OpenOrder[]>([]);
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<OpenOrder | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', pincode: '', line1: '', line2: '', state: '', productId: '' });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (customerId) load(); }, [customerId]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ orders }, { products }] = await Promise.all([
        api.listOpenOrders(customerId),
        api.listProducts(customerId),
      ]);
      setOpenMap(new Map(orders.map((o) => [String(o.trackingId), o])));
      setProducts(products);
    } catch (e: any) {
      setFlash({ kind: 'err', text: 'Load failed: ' + e.message });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const onScan = (raw: string) => {
    const id = raw.trim();
    if (!id) return;
    setCode('');
    inputRef.current?.focus();

    const order = openMap.get(id);
    if (!order) { setFlash({ kind: 'err', text: `Not found / wrong customer: ${id}` }); return; }
    if (scanned.some((s) => s.trackingId === id)) { setFlash({ kind: 'warn', text: `Already scanned: ${id}` }); return; }
    setScanned((prev) => [order, ...prev]);
    setFlash({ kind: 'ok', text: `Added: ${order.receiverName} (${order.receiverState})` });
  };

  const removeScan = (id: string) => setScanned((prev) => prev.filter((s) => s.trackingId !== id));

  const startEdit = (o: OpenOrder) => {
    setEditing(o);
    setEditForm({
      name: o.receiverName, phone: o.receiverPhone, pincode: o.receiverPincode,
      line1: o.receiverLine1, line2: o.receiverLine2, state: o.receiverState, productId: o.productId,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const e = editForm;
    if (!e.name || !e.phone || !e.line1 || !e.line2 || e.pincode.replace(/\D/g, '').length !== 6) {
      alert('Name, phone, both address lines and a valid pincode are required.'); return;
    }
    setBusy(true);
    const fields = {
      receiverName: e.name.trim(), receiverPhone: e.phone.trim(),
      receiverPincode: e.pincode.replace(/\D/g, ''), receiverLine1: e.line1.trim(),
      receiverLine2: e.line2.trim(), receiverState: (e.state || stateFromPincode(e.pincode)).trim(),
      productId: e.productId,
    };
    try {
      await api.updateOrder(customerId, { trackingId: editing.trackingId }, fields);
      const updated: OpenOrder = { ...editing, ...fields };
      setOpenMap((prev) => { const m = new Map(prev); m.set(editing.trackingId, updated); return m; });
      setScanned((prev) => prev.map((s) => (s.trackingId === editing.trackingId ? updated : s)));
      setEditing(null);
      setFlash({ kind: 'ok', text: `Updated ${updated.receiverName}` });
    } catch (err: any) {
      const msg = err.code === 'ALREADY_SHIPPED' ? 'Already shipped — cannot edit.' : err.message;
      alert('Update failed: ' + msg);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (scanned.length === 0) { alert('Scan some packets first.'); return; }
    const rows: DtdcOrder[] = scanned.map((s) => ({
      trackingId: s.trackingId, productId: s.productId,
      receiverName: s.receiverName, receiverPhone: s.receiverPhone,
      receiverPincode: s.receiverPincode, receiverLine1: s.receiverLine1,
      receiverLine2: s.receiverLine2, receiverState: s.receiverState,
    }));
    downloadDtdc(rows, products);
  };

  const markShipped = async () => {
    if (scanned.length === 0) { alert('Nothing scanned.'); return; }
    if (!window.confirm(`Mark ${scanned.length} packets shipped and record a manifest?`)) return;
    setBusy(true);
    try {
      const ids = scanned.map((s) => s.trackingId);
      const res = await api.commitShipment(customerId, ids);
      setOpenMap((prev) => { const m = new Map(prev); res.marked.forEach((id) => m.delete(id)); return m; });
      setScanned([]);
      setFlash({ kind: 'ok', text: `Shipped ${res.marked.length}. ${res.alreadyShipped.length} already shipped, ${res.notFound.length} not found.` });
    } catch (e: any) {
      setFlash({ kind: 'err', text: 'Commit failed: ' + e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin(profile)) return <div className="page-title">Admins only.</div>;
  if (!customerId) {
    return <div><h1 className="page-title">Scan &amp; Book</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to scan their parcels.</p></div>;
  }

  const stateCounts = countBy(scanned, (s) => s.receiverState || '—');

  return (
    <div className="fade-in" style={{ paddingBottom: '4rem' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <ScanLine size={28} style={{ color: 'var(--primary-color)' }} /> Scan & Book
      </h1>

      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <label className="input-label">Scan tracking barcode</label>
        <input
          ref={inputRef}
          className="input-field"
          style={{ fontSize: '1.1rem', letterSpacing: '1px' }}
          placeholder={loading ? 'Loading open orders…' : 'Scan or type tracking ID, press Enter'}
          value={code}
          autoFocus
          disabled={loading}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onScan(code); }}
        />
        {flash && (
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600,
            color: flash.kind === 'ok' ? 'var(--success-color)' : flash.kind === 'warn' ? 'var(--warning-color)' : 'var(--danger-color)' }}>
            {flash.kind === 'ok' ? <Check size={18} /> : <AlertTriangle size={18} />} {flash.text}
          </div>
        )}
        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {openMap.size} open · {scanned.length} scanned
        </p>
      </div>

      {scanned.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={exportCsv}><FileSpreadsheet size={18} /> Export DTDC xlsx</button>
            <button className="btn btn-primary" onClick={markShipped} disabled={busy} style={{ background: '#10b981' }}>
              <Truck size={18} /> {busy ? 'Saving…' : 'Mark Shipped'}
            </button>
          </div>

          <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>By state</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {Object.entries(stateCounts).map(([st, n]) => <span key={st} className="badge badge-primary">{st}: {n}</span>)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {scanned.map((s) => (
              <div key={s.trackingId} className="glass-card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{s.receiverName}</strong>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => startEdit(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)' }}><Pencil size={16} /></button>
                    <button onClick={() => removeScan(s.trackingId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)' }}><X size={18} /></button>
                  </div>
                </div>
                <p style={{ margin: '0.25rem 0', fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.trackingId}</p>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{s.receiverPincode} · {s.receiverState}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
          <div className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 440, background: 'white', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Edit Order</h3>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0 }}>{editing.trackingId}</p>
            <EF label="Name *" v={editForm.name} on={(v) => setEditForm({ ...editForm, name: v })} />
            <EF label="Phone *" v={editForm.phone} on={(v) => setEditForm({ ...editForm, phone: v })} />
            <EF label="Pincode *" v={editForm.pincode} on={(v) => setEditForm({ ...editForm, pincode: v, state: stateFromPincode(v) || editForm.state })} />
            <EF label="State" v={editForm.state} on={(v) => setEditForm({ ...editForm, state: v })} />
            <EF label="Address Line 1 *" v={editForm.line1} on={(v) => setEditForm({ ...editForm, line1: v })} />
            <EF label="Address Line 2 *" v={editForm.line2} on={(v) => setEditForm({ ...editForm, line2: v })} />
            <div className="input-group">
              <label className="input-label">Product</label>
              <select className="input-field" value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })}>
                {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const EF = ({ label, v, on }: { label: string; v: string; on: (v: string) => void }) => (
  <div className="input-group" style={{ margin: '0 0 0.6rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} onChange={(e) => on(e.target.value)} />
  </div>
);

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  return arr.reduce((acc, x) => { const k = key(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
}
