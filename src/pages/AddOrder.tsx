import { useState, useEffect } from 'react';
import { Wand2, Save, AlertCircle, Package, Printer, Trash2, Pencil, WifiOff } from 'lucide-react';
import { parseRawAddress } from '../lib/parser';
import { api, Product, OrderInput } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { stateFromPincode, isValidPincode } from '../lib/pincode';
import { validateContact, minChars, isValidIndianMobile } from '../lib/validate';
import { isServiceable } from '../lib/serviceable';
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
  // True once the operator has run Auto-extract or tried to Add — gates the
  // "captured / still needed" summary and the red field highlights, so a fresh
  // empty form isn't shown all-red.
  const [attempted, setAttempted] = useState(false);
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

  // A valid single-line address (Line 1 only) shouldn't be blocked by the Line 2
  // rule — fill Line 2 with "..." so it passes and the operator can edit it.
  const withLine2Default = (form: typeof EMPTY) =>
    minChars(form.line1) && !form.line2.trim() ? { ...form, line2: '...' } : form;

  const onParse = () => {
    const r = parseRawAddress(raw);
    setF((prev) => withLine2Default({
      ...prev,
      name: r.name || prev.name,
      phone: r.phone || prev.phone,
      pincode: r.pincode || prev.pincode,
      state: r.state || stateFromPincode(r.pincode) || prev.state,
      line1: r.line1 || prev.line1,
      line2: r.line2 || prev.line2,
    }));
    setAttempted(true);
  };

  const onPincode = (v: string) => {
    setF((prev) => ({ ...prev, pincode: v, state: stateFromPincode(v) || prev.state }));
  };

  const addToStack = async () => {
    const ff = withLine2Default(f); // single-line address → Line 2 "..."
    setAttempted(true);
    const problem = validateContact({ name: ff.name, phone: ff.phone, line1: ff.line1, line2: ff.line2 });
    if (problem) { notify(problem, 'error'); return; }
    if (!isValidPincode(ff.pincode)) { notify('Enter a valid 6-digit pincode.', 'error'); return; }
    if (!isServiceable(ff.pincode)) { notify(`Pincode ${ff.pincode.replace(/\D/g, '')} is not in the DTDC serviceable list. Check the pincode, or refresh the list if it was recently added.`, 'error'); return; }
    if (!ff.productId) { notify('Select a product.', 'error'); return; }

    const existing = editId ? pending.find((p) => p.clientOrderId === editId) : null;
    const order: PendingOrder = {
      clientOrderId: editId || newClientOrderId(),
      customerId,
      productId: ff.productId,
      receiverName: ff.name.trim(),
      receiverPhone: ff.phone.trim(),
      receiverPincode: ff.pincode.replace(/\D/g, ''),
      receiverLine1: ff.line1.trim(),
      receiverLine2: ff.line2.trim(),
      receiverState: (ff.state || stateFromPincode(ff.pincode)).trim(),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await addPending(order); // put() upserts by clientOrderId
    setRaw(''); setF({ ...EMPTY }); setAdding(false); setEditId(null); setAttempted(false);
    refresh();
  };

  const startEdit = (o: PendingOrder) => {
    setEditId(o.clientOrderId);
    setAttempted(false);
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

  // Field-level validity → drives the inline red highlights and the post-extract
  // "captured / still needed" summary. Only surfaced once `attempted`.
  const errs = {
    name: minChars(f.name) ? '' : 'Min 3 characters',
    phone: isValidIndianMobile(f.phone) ? '' : 'Enter a valid Indian mobile number',
    pincode: !isValidPincode(f.pincode) ? 'Enter a valid 6-digit pincode'
      : !isServiceable(f.pincode) ? 'Not in the serviceable list' : '',
    line1: minChars(f.line1) ? '' : 'Min 3 characters',
    line2: minChars(f.line2) ? '' : 'Min 3 characters',
  };
  const err = (k: keyof typeof errs) => (attempted ? errs[k] : '');
  const SUMMARY: [keyof typeof errs, string][] = [
    ['name', 'Name'], ['phone', 'Phone'], ['pincode', 'Pincode'],
    ['line1', 'Address Line 1'], ['line2', 'Address Line 2'],
  ];
  const needed = SUMMARY.filter(([k]) => errs[k]).map(([, l]) => l);
  const captured = SUMMARY.filter(([k]) => !errs[k]).map(([, l]) => l);
  const nothingParsed = !f.name.trim() && !f.phone.trim() && !f.pincode.trim() && !f.line1.trim();

  if (!customerId) {
    return <div><h1 className="page-title">Book Orders</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to start booking.</p></div>;
  }

  return (
    <div style={{ paddingBottom: '5rem' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Book Orders</h1>
        <button className="btn btn-primary" onClick={() => { if (adding) { setEditId(null); setF({ ...EMPTY }); } setAttempted(false); setAdding(!adding); }} style={{ width: 'auto' }}>
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

          {attempted && (
            nothingParsed ? (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger-color)', borderRadius: 'var(--radius-md)', color: 'var(--danger-color)', fontSize: '0.85rem', fontWeight: 600 }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} /> Couldn't read this message — please fill the form manually.
              </div>
            ) : (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 0.9rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                {captured.length > 0 && <div style={{ color: 'var(--success-color)', fontWeight: 600 }}>Captured: {captured.join(', ')}</div>}
                {needed.length > 0
                  ? <div style={{ color: 'var(--warning-color)', fontWeight: 600 }}>Still needed: {needed.join(', ')}</div>
                  : <div style={{ color: 'var(--success-color)', fontWeight: 600 }}>All set — review and Add.</div>}
              </div>
            )
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            <In label="Name *" v={f.name} on={(v) => setF({ ...f, name: v })} error={err('name')} />
            <In label="Phone *" v={f.phone} on={(v) => setF({ ...f, phone: v })} error={err('phone')} />
            <In label="Pincode *" v={f.pincode} on={onPincode} error={err('pincode')} />
            <In label="State (auto)" v={f.state} on={(v) => setF({ ...f, state: v })} />
          </div>
          <In label="Address Line 1 *" v={f.line1} on={(v) => setF({ ...f, line1: v })} error={err('line1')} />
          <In label="Address Line 2 *" v={f.line2} on={(v) => setF({ ...f, line2: v })} error={err('line2')} />

          <div className="input-group">
            <label className="input-label">Product *</label>
            <select className="input-field" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}
              style={attempted && !f.productId ? { borderColor: 'var(--danger-color)' } : undefined}>
              <option value="">-- Choose --</option>
              {bookable.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
            </select>
            {attempted && !f.productId && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '0.25rem' }}>Select a product</div>}
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

const In = ({ label, v, on, error }: { label: string; v: string; on: (v: string) => void; error?: string }) => (
  <div className="input-group" style={{ margin: '0 0 0.75rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} onChange={(e) => on(e.target.value)}
      style={error ? { borderColor: 'var(--danger-color)' } : undefined} />
    {error && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{error}</div>}
  </div>
);
