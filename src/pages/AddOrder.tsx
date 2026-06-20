import { useState, useEffect } from 'react';
import { Wand2, Save, AlertCircle, Package, Printer, Trash2, Pencil, WifiOff, History, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { parseRawAddress } from '../lib/parser';
import { api, Product, OrderInput, OrderRow } from '../lib/api';
import { LabelOrder } from '../lib/labels';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { stateFromPincode, isValidPincode } from '../lib/pincode';
import {
  addPending, listPending, deletePending, clearPending,
  newClientOrderId, PendingOrder,
  saveBatch, listBatches, SavedBatch,
} from '../lib/outbox';
import { downloadLabels } from '../lib/labels';

const EMPTY = { name: '', phone: '', pincode: '', line1: '', line2: '', state: '', productId: '' };

export const AddOrder = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;

  const [products, setProducts] = useState<Product[]>([]);
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [localBatches, setLocalBatches] = useState<SavedBatch[]>([]);
  const [serverOrders, setServerOrders] = useState<OrderRow[] | null>(null); // null = couldn't load (offline)
  const [balance, setBalance] = useState<{ remaining: number; low: boolean } | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [f, setF] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { if (customerId) { loadProducts(); refresh(); refreshHistory(); } }, [customerId]);

  const loadProducts = async () => {
    try { setProducts((await api.listProducts(customerId)).products); }
    catch (e: any) { console.error(e); }
  };
  const refresh = async () => setPending(await listPending(customerId));

  // History is server-backed (survives a new device / cleared browser) and shows
  // live status. We fall back to the local IndexedDB cache when offline.
  const refreshHistory = async () => {
    setLocalBatches(await listBatches(customerId));
    try {
      const [{ orders }, bal] = await Promise.all([
        api.listOrders(customerId, 400),
        api.customerBalance(customerId).catch(() => null),
      ]);
      setServerOrders(orders);
      if (bal) setBalance({ remaining: bal.remaining, low: bal.low });
    } catch {
      setServerOrders(null); // offline → render the local cache instead
    }
  };

  const keyName = `shipeasy.batchKey.${customerId}`;
  const getBatchKey = () => {
    let k = localStorage.getItem(keyName);
    if (!k) { k = newClientOrderId(); localStorage.setItem(keyName, k); }
    return k;
  };

  const onParse = () => {
    const r = parseRawAddress(raw);
    setF((prev) => ({ ...prev, name: r.name || prev.name, phone: r.phone || prev.phone, line1: r.address || prev.line1 }));
  };

  const onPincode = (v: string) => {
    setF((prev) => ({ ...prev, pincode: v, state: stateFromPincode(v) || prev.state }));
  };

  const addToStack = async () => {
    if (!f.name || !f.phone || !f.line1 || !f.line2) { alert('Name, phone, and both address lines are required.'); return; }
    if (!isValidPincode(f.pincode)) { alert('Enter a valid 6-digit pincode.'); return; }
    if (!f.productId) { alert('Select a product.'); return; }

    const existing = editId ? pending.find((p) => p.clientOrderId === editId) : null;
    const order: PendingOrder = {
      clientOrderId: editId || newClientOrderId(),
      customerId,
      productId: f.productId,
      receiverName: f.name.trim(),
      receiverPhone: f.phone.trim(),
      receiverPincode: f.pincode.replace(/\D/g, ''),
      receiverLine1: f.line1.trim(),
      receiverLine2: f.line2.trim(),
      receiverState: (f.state || stateFromPincode(f.pincode)).trim(),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await addPending(order); // put() upserts by clientOrderId
    setRaw(''); setF({ ...EMPTY }); setAdding(false); setEditId(null);
    refresh();
  };

  const startEdit = (o: PendingOrder) => {
    setEditId(o.clientOrderId);
    setF({
      name: o.receiverName, phone: o.receiverPhone, pincode: o.receiverPincode,
      line1: o.receiverLine1, line2: o.receiverLine2, state: o.receiverState, productId: o.productId,
    });
    setAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeOne = async (id: string, name: string) => {
    if (!window.confirm(`Remove order for ${name}?`)) return;
    if (editId === id) { setEditId(null); setF({ ...EMPTY }); }
    await deletePending(id); refresh();
  };

  const generate = async () => {
    if (pending.length === 0) { alert('Add some orders first.'); return; }
    setGenerating(true);
    const key = getBatchKey();
    const orders: OrderInput[] = pending.map((p) => ({
      clientOrderId: p.clientOrderId, productId: p.productId,
      receiverName: p.receiverName, receiverPhone: p.receiverPhone,
      receiverPincode: p.receiverPincode, receiverLine1: p.receiverLine1,
      receiverLine2: p.receiverLine2, receiverState: p.receiverState,
    }));

    try {
      const res = await api.generateLabels(customerId, key, orders);
      const byId = new Map(pending.map((p) => [p.clientOrderId, p]));
      const labelOrders = res.assignments.map((a) => {
        const p = byId.get(a.clientOrderId)!;
        return {
          trackingId: a.trackingId, productId: p.productId,
          receiverName: p.receiverName, receiverPhone: p.receiverPhone,
          receiverPincode: p.receiverPincode, receiverLine1: p.receiverLine1,
          receiverLine2: p.receiverLine2,
        };
      });
      downloadLabels(labelOrders, products);
      await saveBatch({
        batchId: res.batchId,
        customerId,
        createdAt: Date.now(),
        count: labelOrders.length,
        labels: labelOrders,
        products, // snapshot, so re-printing works even if a product later changes
      });
      await clearPending(pending.map((p) => p.clientOrderId));
      localStorage.removeItem(keyName);
      refresh();
      refreshHistory();
      alert(`Generated ${res.assignments.length} labels (batch ${res.batchId.slice(0, 8)}).`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_IDS') {
        alert(`Not enough tracking IDs left (only ${e.available} available). Ask admin to top up.`);
      } else {
        alert('Generate failed: ' + (e as Error).message + '\nYour stack is kept — you can retry.');
      }
    } finally {
      setGenerating(false);
    }
  };

  // A batch as the UI needs it, built from either the server (with live status,
  // preferred) or the local IndexedDB cache (offline fallback).
  type UiLabel = LabelOrder & { status?: string };
  type UiBatch = { batchId: string; createdAt: number; labels: UiLabel[]; products: Product[] };

  let uiBatches: UiBatch[];
  if (serverOrders !== null) {
    const byBatch = new Map<string, UiBatch>();
    for (const o of serverOrders) {
      const id = o.batchId || o.orderId;
      let b = byBatch.get(id);
      if (!b) { b = { batchId: id, createdAt: Date.parse(o.createdAt) || 0, labels: [], products }; byBatch.set(id, b); }
      b.labels.push({
        trackingId: o.trackingId, productId: o.productId, status: o.status,
        receiverName: o.receiverName, receiverPhone: o.receiverPhone, receiverPincode: o.receiverPincode,
        receiverLine1: o.receiverLine1, receiverLine2: o.receiverLine2,
      });
    }
    uiBatches = [...byBatch.values()].sort((a, b) => b.createdAt - a.createdAt);
  } else {
    uiBatches = localBatches.map((b) => ({ batchId: b.batchId, createdAt: b.createdAt, labels: b.labels, products: b.products }));
  }

  const regenerate = (b: UiBatch) =>
    downloadLabels(b.labels, b.products, `labels_${b.batchId.slice(0, 8)}.pdf`);

  // Group batches by local calendar day (newest-first).
  const groups: { day: string; items: UiBatch[] }[] = [];
  for (const b of uiBatches) {
    const day = new Date(b.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const g = groups.find((x) => x.day === day);
    if (g) g.items.push(b); else groups.push({ day, items: [b] });
  }

  if (!customerId) {
    return <div><h1 className="page-title">Book Orders</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to start booking.</p></div>;
  }

  return (
    <div style={{ paddingBottom: '5rem' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Book Orders</h1>
        <button className="btn btn-primary" onClick={() => { if (adding) { setEditId(null); setF({ ...EMPTY }); } setAdding(!adding); }} style={{ width: 'auto' }}>
          {adding ? 'Close' : '+ Add Order'}
        </button>
      </div>

      {products.length === 0 && (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warning-color)', borderRadius: 'var(--radius-lg)', color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <AlertCircle size={24} /> <span>No products yet — add one under Products before booking.</span>
        </div>
      )}

      {balance?.low && (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger-color)', borderRadius: 'var(--radius-lg)', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <AlertCircle size={24} /> <span>Only <strong>{balance.remaining}</strong> tracking IDs left — ask your admin to top up before they run out.</span>
        </div>
      )}

      {adding && (
        <div className="glass-card slide-up" style={{ marginBottom: '1.5rem' }}>
          <div className="input-group">
            <label className="input-label">Paste raw message (optional)</label>
            <textarea className="input-field" style={{ minHeight: '90px' }} placeholder="Paste WhatsApp text…" value={raw} onChange={(e) => setRaw(e.target.value)} />
          </div>
          <button className="btn btn-outline" onClick={onParse} style={{ marginBottom: '1rem' }}><Wand2 size={16} /> Auto-extract</button>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            <In label="Name *" v={f.name} on={(v) => setF({ ...f, name: v })} />
            <In label="Phone *" v={f.phone} on={(v) => setF({ ...f, phone: v })} />
            <In label="Pincode *" v={f.pincode} on={onPincode} />
            <In label="State (auto)" v={f.state} on={(v) => setF({ ...f, state: v })} />
          </div>
          <In label="Address Line 1 *" v={f.line1} on={(v) => setF({ ...f, line1: v })} />
          <In label="Address Line 2 *" v={f.line2} on={(v) => setF({ ...f, line2: v })} />

          <div className="input-group">
            <label className="input-label">Product *</label>
            <select className="input-field" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
              <option value="">-- Choose --</option>
              {products.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
            </select>
          </div>

          <button className="btn btn-primary" onClick={addToStack} style={{ width: '100%' }}>
            <Save size={18} /> {editId ? 'Update Order' : 'Add to Stack'}
          </button>
        </div>
      )}

      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
        Current Stack ({pending.length})
        <span title="Saved locally; syncs on Generate Labels" style={{ display: 'inline-flex' }}><WifiOff size={14} /></span>
      </h3>

      {pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
          <Package size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>Your stack is empty.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {pending.map((o) => (
            <div key={o.clientOrderId} className="glass-card" style={{ padding: '1rem', borderLeft: '4px solid var(--primary-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>{o.receiverName}</h4>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => startEdit(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)' }}><Pencil size={18} /></button>
                  <button onClick={() => removeOne(o.clientOrderId, o.receiverName)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)' }}><Trash2 size={18} /></button>
                </div>
              </div>
              <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>{o.receiverPhone} · {o.receiverPincode} · {o.receiverState}</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{o.receiverLine1}, {o.receiverLine2}</p>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button onClick={generate} disabled={generating} className="btn btn-primary" style={{ width: '100%', maxWidth: '340px', background: '#10b981', padding: '1rem' }}>
            <Printer size={18} /> {generating ? 'Generating…' : `Generate ${pending.length} Labels`}
          </button>
        </div>
      )}

      {uiBatches.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
            <History size={18} /> Label History
            {serverOrders === null && <span title="Offline — showing this device's cache" style={{ display: 'inline-flex' }}><WifiOff size={14} /></span>}
          </h3>
          {groups.map((g) => (
            <div key={g.day} style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 0.5rem' }}>{g.day}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {g.items.map((b) => {
                  const expanded = openBatch === b.batchId;
                  const time = new Date(b.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                  const n = b.labels.length;
                  const shipped = b.labels.filter((l) => l.status === 'shipped').length;
                  const voided = b.labels.filter((l) => l.status === 'void').length;
                  return (
                    <div key={b.batchId} className="glass-card" style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button onClick={() => setOpenBatch(expanded ? null : b.batchId)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: 0, flex: 1, textAlign: 'left' }}>
                          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          <span style={{ fontWeight: 600 }}>{n} label{n === 1 ? '' : 's'}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>· {time} · #{b.batchId.slice(0, 8)}</span>
                          {shipped > 0 && <span className="badge badge-completed">{shipped} shipped</span>}
                          {voided > 0 && <span className="badge badge-gray">{voided} void</span>}
                        </button>
                        <button className="btn btn-outline" onClick={() => regenerate(b)} style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                          <Download size={15} /> Labels
                        </button>
                      </div>
                      {expanded && (
                        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {b.labels.map((l) => (
                            <div key={l.trackingId} style={{ fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.receiverName}</span>
                              {l.status && l.status !== 'labeled' && (
                                <span className={`badge ${l.status === 'shipped' ? 'badge-completed' : 'badge-gray'}`}>{l.status}</span>
                              )}
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, textDecoration: l.status === 'void' ? 'line-through' : 'none' }}>{l.trackingId}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const In = ({ label, v, on }: { label: string; v: string; on: (v: string) => void }) => (
  <div className="input-group" style={{ margin: '0 0 0.75rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} onChange={(e) => on(e.target.value)} />
  </div>
);
