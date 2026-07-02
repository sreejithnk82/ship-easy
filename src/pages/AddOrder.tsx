import { useState, useEffect } from 'react';
import { Save, AlertCircle, Package, Printer, Trash2, Pencil, WifiOff, LayoutGrid, X, ListOrdered, Search } from 'lucide-react';
import { api, Product, OrderInput } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { stateFromPincode, isValidPincode } from '../lib/pincode';
import { validateContact, minChars, isValidIndianMobile } from '../lib/validate';
import { isServiceable, refreshServiceableIfStale } from '../lib/serviceable';
import {
  addPending, listPending, deletePending, clearPending,
  newClientOrderId, PendingOrder, saveBatch,
} from '../lib/outbox';
import type { LabelOrder } from '../lib/labelModel';
import { LabelOutputModal } from '../components/LabelOutputModal';
import { AddressSorter, SortedFields } from '../components/AddressSorter';
import { useToast, useConfirm } from '../components/feedback';

const EMPTY = { name: '', phone: '', pincode: '', line1: '', line2: '', state: '', productId: '', variant: '', extraProductIds: [] as string[], extraVariants: [] as string[] };
const MAX_EXTRA = 4; // up to 5 products per parcel (1 primary + 4 extra)

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
  const [sorting, setSorting] = useState(false); // drag-and-drop sorter modal open
  const [showCounts, setShowCounts] = useState(false); // product-count popup
  const [productHints, setProductHints] = useState(''); // leftover sorter lines → rank products
  const [generating, setGenerating] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [query, setQuery] = useState(''); // client-side search over active orders
  // The just-generated batch, shown in the size/Download/Print modal.
  const [outputBatch, setOutputBatch] = useState<{ labels: LabelOrder[]; products: Product[] } | null>(null);

  useEffect(() => { if (customerId) { loadProducts(); refresh(); refreshBalance(); refreshServiceableIfStale(); } }, [customerId]);

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

  // Remember the last product booked for this customer so it's offered first /
  // pre-selected next time — most orders in a session share one product.
  const lastProductKey = `shipeasy.lastProduct.${customerId}`;
  const getLastProduct = () => { try { return localStorage.getItem(lastProductKey) || ''; } catch { return ''; } };

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

  const onPincode = (v: string) => {
    setF((prev) => ({ ...prev, pincode: v, state: stateFromPincode(v) || prev.state }));
  };

  // Extra products (same parcel). Setting an existing slot to '' removes it.
  // extraVariants is index-aligned with extraProductIds, so they move together.
  const setExtra = (i: number, val: string) => setF((prev) => {
    const ex = [...(prev.extraProductIds || [])];
    const ev = [...(prev.extraVariants || [])];
    if (val) { ex[i] = val; ev[i] = ''; } // product changed → clear its variant
    else { ex.splice(i, 1); ev.splice(i, 1); }
    return { ...prev, extraProductIds: ex, extraVariants: ev };
  });
  const addExtra = (val: string) => { if (val) setF((prev) => ({ ...prev, extraProductIds: [...(prev.extraProductIds || []), val], extraVariants: [...(prev.extraVariants || []), ''] })); };
  const setExtraVariant = (i: number, val: string) => setF((prev) => {
    const ev = [...(prev.extraVariants || [])];
    ev[i] = val;
    return { ...prev, extraVariants: ev };
  });
  // Variant labels a product offers (empty → no second choice needed).
  const variantsOf = (id: string): string[] => productById.get(id)?.variants || [];

  // The drag-and-drop sorter fills the form, then the operator reviews and Adds.
  const onSorted = (s: SortedFields) => {
    setF((prev) => withLine2Default({
      ...prev,
      name: s.name || prev.name,
      phone: s.phone || prev.phone,
      pincode: s.pincode || prev.pincode,
      state: stateFromPincode(s.pincode) || prev.state,
      line1: s.line1 || prev.line1,
      line2: s.line2 || prev.line2,
    }));
    setProductHints(s.hints || '');
    setAttempted(true);
    setSorting(false);
  };

  const addToStack = async () => {
    const ff = withLine2Default(f); // single-line address → Line 2 "..."
    setAttempted(true);
    const problem = validateContact({ name: ff.name, phone: ff.phone, line1: ff.line1, line2: ff.line2 });
    if (problem) { notify(problem, 'error'); return; }
    if (!isValidPincode(ff.pincode)) { notify('Enter a valid 6-digit pincode.', 'error'); return; }
    if (!isServiceable(ff.pincode)) { notify(`Pincode ${ff.pincode.replace(/\D/g, '')} is not in the DTDC serviceable list. Check the pincode, or refresh the list if it was recently added.`, 'error'); return; }
    if (!ff.productId) { notify('Select a product.', 'error'); return; }
    // A variant must be chosen for any product that defines variants.
    if (variantsOf(ff.productId).length && !ff.variant) { notify('Select a variant for the product.', 'error'); return; }

    // Pair extras with their variants and drop empty slots in lockstep.
    const exPairs = (ff.extraProductIds || [])
      .map((id, i) => ({ id, v: (ff.extraVariants || [])[i] || '' }))
      .filter((p) => p.id);
    for (const p of exPairs) {
      if (variantsOf(p.id).length && !p.v) { notify(`Select a variant for ${productById.get(p.id)?.name || 'the added product'}.`, 'error'); return; }
    }

    const existing = editId ? pending.find((p) => p.clientOrderId === editId) : null;
    const order: PendingOrder = {
      clientOrderId: editId || newClientOrderId(),
      customerId,
      productId: ff.productId,
      variant: ff.variant || '',
      extraProductIds: exPairs.map((p) => p.id),
      extraVariants: exPairs.map((p) => p.v),
      receiverName: ff.name.trim(),
      receiverPhone: ff.phone.trim(),
      receiverPincode: ff.pincode.replace(/\D/g, ''),
      receiverLine1: ff.line1.trim(),
      receiverLine2: ff.line2.trim(),
      receiverState: (ff.state || stateFromPincode(ff.pincode)).trim(),
      createdAt: existing?.createdAt ?? Date.now(),
      sourceText: raw.trim() || existing?.sourceText, // keep the pasted block for later reference
    };
    await addPending(order); // put() upserts by clientOrderId
    try { localStorage.setItem(lastProductKey, ff.productId); } catch { /* ignore */ }
    setRaw(''); setF({ ...EMPTY }); setAdding(false); setEditId(null); setAttempted(false);
    refresh();
  };

  const startEdit = (o: PendingOrder) => {
    setRaw(o.sourceText || ''); // show what was originally pasted
    setEditId(o.clientOrderId);
    setAttempted(false);
    setF({
      name: o.receiverName, phone: o.receiverPhone, pincode: o.receiverPincode,
      line1: o.receiverLine1, line2: o.receiverLine2, state: o.receiverState, productId: o.productId,
      variant: o.variant || '',
      extraProductIds: o.extraProductIds || [],
      extraVariants: o.extraVariants || [],
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

    // Warn (don't block) on likely duplicates: same pincode AND matching name or phone.
    const dupGroups = findDuplicateGroups(pending);
    if (dupGroups.length) {
      const ok = await confirm({
        title: 'Possible duplicates',
        message: (
          <div style={{ fontSize: '0.9rem' }}>
            <p style={{ marginTop: 0 }}>These look like duplicate orders (same pincode, with a matching name or phone):</p>
            <ul style={{ margin: '0 0 0.6rem', paddingLeft: '1.1rem' }}>
              {dupGroups.map((g, i) => (
                <li key={i} style={{ marginBottom: '0.3rem' }}>
                  {g.map((o) => o.receiverName).join(', ')} — PIN {g[0].receiverPincode} ({g.length} orders)
                </li>
              ))}
            </ul>
            <strong>Generate labels anyway?</strong>
          </div>
        ),
        confirmLabel: 'Generate anyway', danger: true,
      });
      if (!ok) return;
    }

    // Block before hitting the server when we already know there aren't enough IDs.
    if (balance && balance.remaining < pending.length) {
      notify(`Not enough tracking IDs: ${balance.remaining} left but ${pending.length} needed. Ask your admin to top up before generating.`, 'error');
      return;
    }
    setGenerating(true);
    const key = getBatchKey();
    const orders: OrderInput[] = pending.map((p) => ({
      clientOrderId: p.clientOrderId, productId: p.productId, extraProductIds: p.extraProductIds || [],
      variant: p.variant || '', extraVariants: p.extraVariants || [],
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
      const snapshot = products;
      await saveBatch({
        batchId: res.batchId,
        customerId,
        createdAt: Date.now(),
        count: labelOrders.length,
        labels: labelOrders,
        products: snapshot, // snapshot, so re-printing works even if a product later changes
      });
      await clearPending(pending.map((p) => p.clientOrderId));
      localStorage.removeItem(keyName);
      refresh();
      refreshBalance();
      // Choose size + Download/Print at output time (also always available in Label History).
      setOutputBatch({ labels: labelOrders, products: snapshot });
      notify(`Generated ${res.assignments.length} labels (batch ${res.batchId.slice(0, 8)}). Choose a size to download or print — also saved under Label History.`, 'success');
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

  // Client-side search over the loaded active orders (name / phone / pincode /
  // state / product). Generate still acts on ALL pending — this only locates.
  const q = query.trim().toLowerCase();
  const orderMatches = (o: PendingOrder) => {
    if (!q) return true;
    const prods = [o.productId, ...(o.extraProductIds || [])].map((id) => productById.get(id)?.name || '').join(' ');
    return [o.receiverName, o.receiverPhone, o.receiverPincode, o.receiverState, prods]
      .some((v) => String(v || '').toLowerCase().includes(q));
  };
  const visiblePending = q ? pending.filter(orderMatches) : pending;

  // Only verified products can be booked (members add products as "pending").
  const bookable = products.filter((p) => p.status !== 'pending');
  // Rank the dropdown: products matching the sorter's leftover hints float to the
  // top; ties fall back to the last-used product; then original order.
  const lastProductId = getLastProduct();
  const hintTokens = productHints.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const hintScore = (p: Product) => {
    if (!hintTokens.length) return 0;
    const hay = `${p.name} ${p.content || ''} ${p.description || ''}`.toLowerCase();
    return hintTokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
  };
  const bookableSorted = (hintTokens.length || lastProductId)
    ? [...bookable].sort((a, b) => {
        const d = hintScore(b) - hintScore(a);
        if (d) return d;
        return (b.productId === lastProductId ? 1 : 0) - (a.productId === lastProductId ? 1 : 0);
      })
    : bookable;

  // Open the Add form fresh. The last product is floated to the top of the
  // dropdown but NOT pre-selected — the operator still picks deliberately.
  const openAdd = () => {
    setRaw(''); setEditId(null); setAttempted(false); setProductHints(''); setF({ ...EMPTY }); setAdding(true);
  };

  // Field-level validity → drives the inline red highlights. Only surfaced once
  // `attempted` (set by the sorter's onSorted or a failed addToStack).
  const errs = {
    name: minChars(f.name) ? '' : 'Min 3 characters',
    phone: isValidIndianMobile(f.phone) ? '' : 'Enter a valid Indian mobile number',
    pincode: !isValidPincode(f.pincode) ? 'Enter a valid 6-digit pincode'
      : !isServiceable(f.pincode) ? 'Not in the serviceable list' : '',
    line1: minChars(f.line1) ? '' : 'Min 3 characters',
    line2: minChars(f.line2) ? '' : 'Min 3 characters',
  };
  const err = (k: keyof typeof errs) => (attempted ? errs[k] : '');

  const closeForm = () => { setRaw(''); setEditId(null); setF({ ...EMPTY }); setAttempted(false); setProductHints(''); setAdding(false); };

  if (!customerId) {
    return <div><h1 className="page-title">Book Orders</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to start booking.</p></div>;
  }

  return (
    <div style={{ paddingBottom: '5rem' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Book Orders</h1>
        <button className="btn btn-primary" onClick={() => (adding ? closeForm() : openAdd())} style={{ width: 'auto' }}>
          + Add Order
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'var(--bg-color)', overflowY: 'auto' }}>
          <div className="slide-up" style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1.25rem 4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0 }}>{editId ? 'Edit Order' : 'Add Order'}</h2>
              <button onClick={closeForm} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={26} /></button>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="input-label" style={{ margin: 0 }}>Enter address text</label>
                {raw && <button onClick={() => setRaw('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem' }}><X size={14} /> Clear</button>}
              </div>
              <textarea className="input-field" style={{ minHeight: '90px' }} placeholder="Paste or type the address…" value={raw} onChange={(e) => setRaw(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={() => setSorting(true)} style={{ width: 'auto', marginBottom: '1rem' }}><LayoutGrid size={16} /> Fill Address</button>

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
              <select className="input-field" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value, variant: '' })}
                style={attempted && !f.productId ? { borderColor: 'var(--danger-color)' } : undefined}>
                <option value="">-- Choose --</option>
                {bookableSorted.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
              </select>
              {attempted && !f.productId && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '0.25rem' }}>Select a product</div>}
            </div>

            {/* Second step: choose the variant, only when the product defines any. */}
            {f.productId && variantsOf(f.productId).length > 0 && (
              <div className="input-group">
                <label className="input-label">Variant *</label>
                <select className="input-field" value={f.variant} onChange={(e) => setF({ ...f, variant: e.target.value })}
                  style={attempted && !f.variant ? { borderColor: 'var(--danger-color)' } : undefined}>
                  <option value="">-- Choose variant --</option>
                  {variantsOf(f.productId).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {attempted && !f.variant && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '0.25rem' }}>Select a variant</div>}
              </div>
            )}

            {/* Additional products in the SAME parcel (one label). Weight is summed; box = largest item. */}
            {f.productId && (
              <div className="input-group">
                <label className="input-label">Additional products (optional — same parcel)</label>
                {(f.extraProductIds || []).map((id, i) => (
                  <div key={i} style={{ marginBottom: '0.5rem' }}>
                    <select className="input-field" value={id} onChange={(e) => setExtra(i, e.target.value)}>
                      <option value="">— remove —</option>
                      {bookableSorted.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
                    </select>
                    {variantsOf(id).length > 0 && (
                      <select className="input-field" value={(f.extraVariants || [])[i] || ''} onChange={(e) => setExtraVariant(i, e.target.value)}
                        style={{ marginTop: '0.35rem', ...(attempted && !((f.extraVariants || [])[i]) ? { borderColor: 'var(--danger-color)' } : {}) }}>
                        <option value="">-- Choose variant --</option>
                        {variantsOf(id).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {(f.extraProductIds || []).length < MAX_EXTRA && (
                  <select className="input-field" value="" onChange={(e) => addExtra(e.target.value)}>
                    <option value="">+ Add another product…</option>
                    {bookableSorted.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.weightG}g)</option>)}
                  </select>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button className="btn btn-outline" onClick={closeForm} style={{ flex: '0 0 auto' }}>Cancel</button>
              <button className="btn btn-primary" onClick={addToStack} style={{ flex: 1 }}>
                <Save size={18} /> {editId ? 'Update Order' : 'Add Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
        Active Orders ({q ? `${visiblePending.length} of ${pending.length}` : pending.length})
        <span title="Saved locally; syncs on Generate Labels" style={{ display: 'inline-flex' }}><WifiOff size={14} /></span>
        {pending.length > 0 && (
          <button className="btn btn-outline" onClick={() => setShowCounts(true)} style={{ width: 'auto', marginLeft: 'auto', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
            <ListOrdered size={15} /> Product counts
          </button>
        )}
      </h3>

      {pending.length > 0 && (
        <div className="input-group" style={{ position: 'relative', margin: '0 0 1rem', maxWidth: 420 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input className="input-field" style={{ paddingLeft: '2rem' }} placeholder="Search name, phone, pincode, product…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')} title="Clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={16} /></button>}
        </div>
      )}

      {pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
          <Package size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>No active orders yet.</p>
        </div>
      ) : visiblePending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)' }}>
          <p>No active orders match "{query}".</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {visiblePending.map((o) => (
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
                {(() => {
                  const label = (id: string, v?: string) => (productById.get(id)?.name || 'Unknown product') + (v ? ` · ${v}` : '');
                  const items = [label(o.productId, o.variant), ...(o.extraProductIds || []).map((id, i) => label(id, (o.extraVariants || [])[i]))];
                  return (
                    <span className="badge badge-primary" title={items.join('\n')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Package size={13} /> {label(o.productId, o.variant)}
                      {o.extraProductIds && o.extraProductIds.length > 0 && ` +${o.extraProductIds.length} more`}
                    </span>
                  );
                })()}
              </div>
              {o.sourceText && (
                <details style={{ marginTop: '0.6rem' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Pasted text</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0', background: 'var(--bg-color)', padding: '0.45rem 0.55rem', borderRadius: 'var(--radius-md)', fontFamily: 'inherit' }}>{o.sourceText}</pre>
                </details>
              )}
            </div>
          ))}
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

      {sorting && <AddressSorter rawInitial={raw} onApply={onSorted} onClose={() => setSorting(false)} />}

      {outputBatch && (
        <LabelOutputModal
          labels={outputBatch.labels}
          products={outputBatch.products}
          title="Download labels"
          onClose={() => setOutputBatch(null)}
        />
      )}

      {showCounts && (() => {
        // Count per product AND variant, so pickers see "Perfume · 100ml: 5".
        const counts = new Map<string, number>();
        let totalItems = 0;
        pending.forEach((o) => {
          const items = [{ id: o.productId, v: o.variant || '' }, ...(o.extraProductIds || []).map((id, i) => ({ id, v: (o.extraVariants || [])[i] || '' }))];
          items.filter((it) => it.id).forEach((it) => {
            const name = productById.get(it.id)?.name || 'Unknown product';
            const key = it.v ? `${name} · ${it.v}` : name;
            counts.set(key, (counts.get(key) || 0) + 1); totalItems++;
          });
        });
        const rows = [...counts.entries()]
          .map(([name, n]) => ({ name, n }))
          .sort((a, b) => b.n - a.n);
        return (
          <div onClick={() => setShowCounts(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
            <div onClick={(e) => e.stopPropagation()} className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 420, background: 'white', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ListOrdered size={20} /> Product counts</h3>
                <button onClick={() => setShowCounts(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
              </div>
              {rows.map((r) => (
                <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Package size={15} style={{ color: 'var(--primary-color)' }} /> {r.name}</span>
                  <strong>{r.n}</strong>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0 0', fontWeight: 700 }}>
                <span>Total products</span><span>{totalItems}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>Parcels / labels</span><span>{pending.length}</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// Group orders that look like duplicates: same pincode AND (same phone OR same
// name). Union-find so A↔B↔C collapse into one cluster. Returns only groups >1.
type DupOrder = { receiverName: string; receiverPhone: string; receiverPincode: string };
function findDuplicateGroups<T extends DupOrder>(orders: T[]): T[][] {
  const pin = (o: T) => String(o.receiverPincode || '').replace(/\D/g, '');
  const phone = (o: T) => String(o.receiverPhone || '').replace(/\D/g, '').slice(-10);
  const name = (o: T) => String(o.receiverName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parent = orders.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const samePin = pin(orders[i]) && pin(orders[i]) === pin(orders[j]);
      if (!samePin) continue;
      const samePhone = phone(orders[i]) && phone(orders[i]) === phone(orders[j]);
      const sameName = name(orders[i]) && name(orders[i]) === name(orders[j]);
      if (samePhone || sameName) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  orders.forEach((o, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(o); });
  return [...groups.values()].filter((g) => g.length > 1);
}

const In = ({ label, v, on, error }: { label: string; v: string; on: (v: string) => void; error?: string }) => (
  <div className="input-group" style={{ margin: '0 0 0.75rem' }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} onChange={(e) => on(e.target.value)}
      style={error ? { borderColor: 'var(--danger-color)' } : undefined} />
    {error && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{error}</div>}
  </div>
);
