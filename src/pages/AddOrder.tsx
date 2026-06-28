import { useState, useEffect } from 'react';
import { Wand2, Save, AlertCircle, Package, Printer, Trash2, Pencil, WifiOff } from 'lucide-react';
import { parseRawAddress } from '../lib/parser';
import { api, Product, OrderInput } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { stateFromPincode, isValidPincode } from '../lib/pincode';
import {
  addPending, listPending, deletePending, clearPending,
  newClientOrderId, PendingOrder, saveBatch,
} from '../lib/outbox';
import { downloadLabels } from '../lib/labels';
import { getLabelFormat, setLabelFormat, LabelFormat } from '../lib/labelFormat';
import { LabelFormatPicker } from '../components/LabelFormatPicker';
import { LabelTile } from '../components/LabelTile';
import { useToast, useConfirm } from '../components/feedback';

const EMPTY = { name: '', phone: '', pincode: '', line1: '', line2: '', state: '', productId: '' };

export const AddOrder = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;
  const notify = useToast();
  const confirm = useConfirm();

  const [products, setProducts] = useState<Product[]>([]);
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [balance, setBalance] = useState<{ remaining: number; low: boolean } | null>(null);
  const [raw, setRaw] = useState('');
  const [f, setF] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [fmt, setFmt] = useState<LabelFormat>(getLabelFormat());
  const [showPreview, setShowPreview] = useState(false);

  const changeFmt = (f: LabelFormat) => { setFmt(f); setLabelFormat(f); };

  useEffect(() => { if (customerId) { loadProducts(); refresh(); refreshBalance(); } }, [customerId]);

  const loadProducts = async () => {
    setLoadingProducts(true);
    try { setProducts((await api.listProducts(customerId)).products); }
    catch (e: any) { console.error(e); }
    finally { setLoadingProducts(false); }
  };
  const refresh = async () => setPending(await listPending(customerId));

  // Remaining tracking IDs (for the count + the generate guard). Best-effort:
  // stays null when offline.
  const refreshBalance = async () => {
    setLoadingBalance(true);
    try {
      const bal = await api.customerBalance(customerId);
      setBalance({ remaining: bal.remaining, low: bal.low });
    } catch {
      /* offline — leave balance as-is */
    } finally {
      setLoadingBalance(false);
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
    if (!f.name || !f.phone || !f.line1 || !f.line2) { notify('Name, phone, and both address lines are required.', 'error'); return; }
    if (!isValidPincode(f.pincode)) { notify('Enter a valid 6-digit pincode.', 'error'); return; }
    if (!f.productId) { notify('Select a product.', 'error'); return; }

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
    if (!(await confirm({ title: 'Remove order', message: <>Remove the order for <strong>{name}</strong> from your active orders?</>, confirmLabel: 'Remove', requireCode: true }))) return;
    if (editId === id) { setEditId(null); setF({ ...EMPTY }); }
    await deletePending(id); refresh();
  };

  const generate = async () => {
    if (pending.length === 0) { notify('Add some orders first.', 'error'); return; }
    // Block before hitting the server when we already know there aren't enough IDs.
    if (balance && balance.remaining < pending.length) {
      notify(`Not enough tracking IDs: ${balance.remaining} left but ${pending.length} needed. Ask your admin to top up before generating.`, 'error');
      return;
    }
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
          receiverLine2: p.receiverLine2, receiverState: p.receiverState,
        };
      });
      downloadLabels(labelOrders, products, fmt);
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
      refreshBalance();
      notify(`Generated ${res.assignments.length} labels (batch ${res.batchId.slice(0, 8)}). See them under Label History.`, 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_IDS') {
        notify(`Not enough tracking IDs left (only ${e.available} available). Ask admin to top up.`, 'error');
      } else {
        notify('Generate failed: ' + (e as Error).message + '\nYour active orders are kept — you can retry.', 'error');
      }
    } finally {
      setGenerating(false);
    }
  };

  const productById = new Map(products.map((p) => [p.productId, p]));
  // Only verified products can be booked (members add products as "pending").
  const bookable = products.filter((p) => p.status !== 'pending');

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

      {loadingProducts ? (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Loading products…</div>
      ) : bookable.length === 0 ? (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warning-color)', borderRadius: 'var(--radius-lg)', color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <AlertCircle size={24} /> <span>{products.length === 0
            ? 'No products yet — add one under Products before booking.'
            : 'No verified products yet — an admin must verify a product before it can be booked.'}</span>
        </div>
      ) : null}

      {balance ? (
        <div style={{ marginBottom: '1.5rem', fontWeight: 600, color: balance.remaining < pending.length + 10 ? 'var(--danger-color)' : 'var(--text-secondary)' }}>
          Tracking IDs left: {balance.remaining}
        </div>
      ) : loadingBalance ? (
        <div style={{ marginBottom: '1.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Tracking IDs left: …</div>
      ) : null}

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
              {bookable.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
            </select>
          </div>

          <button className="btn btn-primary" onClick={addToStack} style={{ width: '100%' }}>
            <Save size={18} /> {editId ? 'Update Order' : 'Add Order'}
          </button>
        </div>
      )}

      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
        Active Orders ({pending.length})
        <span title="Saved locally; syncs on Generate Labels" style={{ display: 'inline-flex' }}><WifiOff size={14} /></span>
      </h3>

      {pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
          <Package size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>No active orders yet.</p>
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
              <div style={{ marginTop: '0.5rem' }}>
                <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Package size={13} /> {productById.get(o.productId)?.name || 'Unknown product'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="glass-card" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
            <LabelFormatPicker value={fmt} onChange={changeFmt} />
            <button className="btn btn-outline" onClick={() => setShowPreview((s) => !s)} style={{ width: 'auto' }}>
              {showPreview ? 'Hide preview' : 'Preview labels'}
            </button>
          </div>
          {showPreview && (
            <>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0.5rem' }}>
                Layout preview — tracking IDs are assigned when you generate.
              </p>
              <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {pending.slice(0, 6).map((o) => (
                  <LabelTile
                    key={o.clientOrderId}
                    scale={0.5}
                    order={{ trackingId: 'SAMPLE0000', productId: o.productId, receiverName: o.receiverName, receiverPhone: o.receiverPhone, receiverPincode: o.receiverPincode, receiverLine1: o.receiverLine1, receiverLine2: o.receiverLine2, receiverState: o.receiverState }}
                    product={productById.get(o.productId)}
                  />
                ))}
              </div>
              {pending.length > 6 && <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>+{pending.length - 6} more</p>}
            </>
          )}
        </div>
      )}

      {pending.length > 0 && (() => {
        const notEnough = balance !== null && balance.remaining < pending.length;
        return (
          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button onClick={generate} disabled={generating || notEnough} className="btn btn-primary" style={{ width: '100%', maxWidth: '340px', background: notEnough ? '#9ca3af' : '#10b981', padding: '1rem' }}>
              <Printer size={18} /> {generating ? 'Generating…' : `Generate ${pending.length} Labels`}
            </button>
            {notEnough && (
              <p style={{ color: 'var(--danger-color)', marginTop: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
                Not enough tracking IDs: {balance!.remaining} left, {pending.length} needed. Ask your admin to top up.
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
};

const In = ({ label, v, on }: { label: string; v: string; on: (v: string) => void }) => (
  <div className="input-group" style={{ margin: '0 0 0.75rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} onChange={(e) => on(e.target.value)} />
  </div>
);
