import { useState, useEffect, useRef } from 'react';
import { ScanLine, FileSpreadsheet, Truck, Check, AlertTriangle, X, Pencil, Ban, Camera, Keyboard, CalendarClock, Tag } from 'lucide-react';
import { api, Product, OpenOrder, ShipmentReport } from '../lib/api';
import { useProfile, isAdmin, canScan } from '../lib/profile';
import { useToast, useConfirm } from '../components/feedback';
import { CameraScanner } from '../components/CameraScanner';
import { istDateLabel, istDateTimeLabel, todayIstDayKey } from '../lib/datetime';
import { useActiveCustomer } from '../lib/activeCustomer';
import { downloadDtdc, DtdcOrder } from '../lib/dtdc';
import { stateFromPincode } from '../lib/pincode';
import { validateContact } from '../lib/validate';
import { isServiceable } from '../lib/serviceable';

type Flash = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

export const ScanBook = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;
  // The warehouse operator is group-less and scans EVERY group's parcels.
  const crossGroup = profile?.role === 'operator';
  const notify = useToast();
  const confirm = useConfirm();

  const [openMap, setOpenMap] = useState<Map<string, OpenOrder>>(new Map());
  const [products, setProducts] = useState<Product[]>([]);
  const [scanned, setScanned] = useState<OpenOrder[]>([]);
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<OpenOrder | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', pincode: '', line1: '', line2: '', state: '', productId: '', variant: '' });
  const [mode, setMode] = useState<'type' | 'camera'>(() => {
    try { return localStorage.getItem('shipeasy.scanMode') === 'camera' ? 'camera' : 'type'; } catch { return 'type'; }
  });
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<ShipmentReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const monthStart = todayIstDayKey().slice(0, 7) + '-01';
  const [reportFrom, setReportFrom] = useState(crossGroup ? todayIstDayKey() : monthStart);
  const [reportTo, setReportTo] = useState(todayIstDayKey());
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist the in-progress scanned selection so a refresh/crash doesn't lose it.
  const scannedKey = `shipeasy.scanned.${crossGroup ? 'warehouse' : customerId}`;
  const hydratedRef = useRef(false); // don't persist until the saved list is restored

  const loadReport = async (from: string, to: string) => {
    setReportLoading(true);
    try { setReport(await api.shipmentReport(customerId, from, to)); }
    catch (e: any) { notify('Report failed: ' + e.message, 'error'); setReport(null); }
    finally { setReportLoading(false); }
  };
  const openReport = () => { setShowReport(true); loadReport(reportFrom, reportTo); };

  const changeMode = (m: 'type' | 'camera') => {
    setMode(m);
    try { localStorage.setItem('shipeasy.scanMode', m); } catch { /* ignore */ }
    if (m === 'type') setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Live mirrors so the long-lived camera scanner reads current state, not a stale closure.
  const openMapRef = useRef(openMap);
  const scannedRef = useRef(scanned);
  // Normalized index (whitespace stripped, uppercased) so a camera read like
  // "r123 456" still matches the stored "R123456" — the usual reason a barcode
  // decodes but nothing gets added.
  const normMapRef = useRef<Map<string, OpenOrder>>(new Map());
  useEffect(() => { openMapRef.current = openMap; }, [openMap]);
  useEffect(() => { scannedRef.current = scanned; }, [scanned]);
  useEffect(() => {
    const m = new Map<string, OpenOrder>();
    openMap.forEach((o, id) => m.set(normId(id), o));
    normMapRef.current = m;
  }, [openMap]);

  // Operator (cross-group) has no customerId — load spans all groups instead.
  useEffect(() => { if (customerId || crossGroup) load(); }, [customerId, crossGroup]);

  // Persist the scanned selection whenever it changes (after the initial restore).
  useEffect(() => {
    if (!hydratedRef.current || (!customerId && !crossGroup)) return;
    try { localStorage.setItem(scannedKey, JSON.stringify(scanned.map((s) => s.trackingId))); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const load = async () => {
    setLoading(true);
    hydratedRef.current = false;
    try {
      // Operator (warehouse) loads open parcels across ALL groups; everyone else
      // loads their one active group. Both stamp each order with its group + hub.
      let orders: OpenOrder[]; let prods: Product[];
      if (crossGroup) {
        const res = await api.listAllOpenOrders();
        orders = res.orders; prods = res.products;
      } else {
        const [openRes, prodRes] = await Promise.all([api.listOpenOrders(customerId), api.listProducts(customerId)]);
        orders = openRes.orders; prods = prodRes.products;
      }
      const map = new Map(orders.map((o) => [String(o.trackingId), o] as [string, OpenOrder]));
      setOpenMap(map);
      setProducts(prods);
      // Restore the in-progress scan from local storage, re-hydrating from the
      // fresh open orders (drops anything no longer open — already shipped, etc.).
      let saved: string[] = [];
      try { saved = JSON.parse(localStorage.getItem(scannedKey) || '[]'); } catch { saved = []; }
      setScanned(saved.map((id) => map.get(String(id))).filter(Boolean) as OpenOrder[]);
    } catch (e: any) {
      setFlash({ kind: 'err', text: 'Load failed: ' + e.message });
    } finally {
      hydratedRef.current = true;
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // Shared by typed input and camera. Reads refs so it stays correct even when
  // called from the long-lived camera modal. Returns the feedback it set.
  const onScan = (raw: string): Flash => {
    const id = raw.trim();
    if (!id) return null;
    setCode('');

    // Exact match first, then a normalized (case/space-insensitive) fallback.
    const order = openMapRef.current.get(id) || normMapRef.current.get(normId(id));
    let f: Flash;
    if (!order) {
      f = { kind: 'err', text: `Not found / wrong customer: ${id}` };
    } else if (scannedRef.current.some((s) => s.trackingId === order.trackingId)) {
      f = { kind: 'warn', text: `Already scanned: ${order.trackingId}` };
    } else {
      setScanned((prev) => [order, ...prev]);
      f = order.exportedAt
        ? { kind: 'warn', text: `Added — ALREADY EXPORTED ${istDateLabel(order.exportedAt)}: ${order.receiverName}` }
        : { kind: 'ok', text: `Added: ${order.receiverName} (${order.receiverState})` };
    }
    setFlash(f);
    return f;
  };

  const removeScan = (id: string) => setScanned((prev) => prev.filter((s) => s.trackingId !== id));

  const voidOrder = async (o: OpenOrder) => {
    const warn = o.exportedAt
      ? '\n\nNOTE: this was already exported to DTDC — make sure you did NOT already book it with the courier.'
      : '';
    if (!(await confirm({
      title: 'Void / cancel order',
      message: `Void / cancel ${o.receiverName} (${o.trackingId})?\nThe tracking ID is cancelled and never reused.${warn}`,
      confirmLabel: 'Void', danger: true,
    }))) return;
    setBusy(true);
    try {
      await api.voidOrder(customerId, o.trackingId);
      setOpenMap((prev) => { const m = new Map(prev); m.delete(o.trackingId); return m; });
      setScanned((prev) => prev.filter((s) => s.trackingId !== o.trackingId));
      setFlash({ kind: 'ok', text: `Voided ${o.receiverName}` });
    } catch (err: any) {
      const msg = err.code === 'ALREADY_SHIPPED' ? 'Already shipped — cannot void.' : err.message;
      notify('Void failed: ' + msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (o: OpenOrder) => {
    setEditing(o);
    setEditForm({
      name: o.receiverName, phone: o.receiverPhone, pincode: o.receiverPincode,
      line1: o.receiverLine1, line2: o.receiverLine2, state: o.receiverState, productId: o.productId,
      variant: o.variant || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const e = editForm;
    const problem = validateContact({ name: e.name, phone: e.phone, line1: e.line1, line2: e.line2 });
    if (problem) { notify(problem, 'error'); return; }
    if (e.pincode.replace(/\D/g, '').length !== 6) { notify('Enter a valid 6-digit pincode.', 'error'); return; }
    if (!isServiceable(e.pincode)) { notify(`Pincode ${e.pincode.replace(/\D/g, '')} is not in the DTDC serviceable list.`, 'error'); return; }
    setBusy(true);
    const fields = {
      receiverName: e.name.trim(), receiverPhone: e.phone.trim(),
      receiverPincode: e.pincode.replace(/\D/g, ''), receiverLine1: e.line1.trim(),
      receiverLine2: e.line2.trim(), receiverState: (e.state || stateFromPincode(e.pincode)).trim(),
      productId: e.productId, variant: e.variant || '',
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
      notify('Update failed: ' + msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Group the scanned parcels by their owning group (a warehouse scan can mix
  // groups) so export/ship are recorded in each group's own sheet.
  const groupScanned = <T,>(pick: (s: OpenOrder) => T): Map<string, T[]> => {
    const by = new Map<string, T[]>();
    scanned.forEach((s) => { const k = s.customerId || customerId; const a = by.get(k) || []; a.push(pick(s)); by.set(k, a); });
    return by;
  };

  const exportCsv = async () => {
    if (scanned.length === 0) { notify('Scan some packets first.', 'error'); return; }

    // Stamp the orders as exported (per group) so the same parcels can't be
    // silently exported twice (a double courier booking). Warn if any already were.
    const alreadyExported: { trackingId: string; exportedAt: string }[] = [];
    const markedAll = new Set<string>();
    let recorded = false;
    setBusy(true);
    try {
      for (const [cid, ids] of Array.from(groupScanned((s) => s.trackingId).entries())) {
        const stamp = await api.recordExport(cid, ids);
        recorded = true;
        stamp.alreadyExported.forEach((a) => alreadyExported.push(a));
        stamp.marked.forEach((id) => markedAll.add(id));
      }
    } catch (e: any) {
      const ok = await confirm({
        title: 'Export anyway?',
        message: 'Could not record the export on the server (offline?).\nDownload the file anyway? (re-export protection will not apply)',
        confirmLabel: 'Download anyway', danger: true,
      });
      if (!ok) { setBusy(false); return; }
    } finally {
      setBusy(false);
    }

    if (alreadyExported.length) {
      const first = alreadyExported[0];
      const ok = await confirm({
        title: 'Already exported',
        message:
          `${alreadyExported.length} of these parcels were ALREADY exported earlier ` +
          `(e.g. ${first.trackingId} on ${istDateTimeLabel(first.exportedAt)}).\n\n` +
          `Re-exporting risks DOUBLE-BOOKING them with the courier. Download anyway?`,
        confirmLabel: 'Download anyway', danger: true,
      });
      if (!ok) return;
    }

    if (recorded && markedAll.size) {
      const now = new Date().toISOString();
      setOpenMap((prev) => { const m = new Map(prev); markedAll.forEach((id) => { const o = m.get(id); if (o) m.set(id, { ...o, exportedAt: now }); }); return m; });
      setScanned((prev) => prev.map((s) => (markedAll.has(s.trackingId) ? { ...s, exportedAt: now } : s)));
    }

    // ONE combined file — each row carries its parcel's own group hub code.
    const rows: DtdcOrder[] = scanned.map((s) => ({
      trackingId: s.trackingId, productId: s.productId, extraProductIds: s.extraProductIds || [],
      variant: s.variant || '', extraVariants: s.extraVariants || [],
      receiverName: s.receiverName, receiverPhone: s.receiverPhone,
      receiverPincode: s.receiverPincode, receiverLine1: s.receiverLine1,
      receiverLine2: s.receiverLine2, receiverState: s.receiverState,
      hubCustomerCode: s.hubCustomerCode,
    }));
    downloadDtdc(rows, products);
  };

  const markShipped = async () => {
    if (scanned.length === 0) { notify('Nothing scanned.', 'error'); return; }
    if (!(await confirm({ title: 'Mark shipped', message: `Mark ${scanned.length} packets shipped and record a manifest? This can't be undone — shipped parcels leave the scan list.`, confirmLabel: 'Mark shipped', requireCode: true }))) return;
    setBusy(true);
    try {
      let marked = 0, already = 0, notFound = 0;
      const markedIds = new Set<string>();
      for (const [cid, ids] of Array.from(groupScanned((s) => s.trackingId).entries())) {
        const res = await api.commitShipment(cid, ids);   // one manifest per group
        marked += res.marked.length; already += res.alreadyShipped.length; notFound += res.notFound.length;
        res.marked.forEach((id) => markedIds.add(id));
      }
      setOpenMap((prev) => { const m = new Map(prev); markedIds.forEach((id) => m.delete(id)); return m; });
      try { localStorage.removeItem(scannedKey); } catch { /* ignore */ }
      setScanned([]);
      setFlash({ kind: 'ok', text: `Shipped ${marked}. ${already} already shipped, ${notFound} not found.` });
    } catch (e: any) {
      setFlash({ kind: 'err', text: 'Commit failed: ' + e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!canScan(profile)) return <div className="page-title">Admins only.</div>;
  if (!customerId && !crossGroup) {
    return <div><h1 className="page-title">Scan &amp; Book</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to scan their parcels.</p></div>;
  }

  const stateCounts = countBy(scanned, (s) => s.receiverState || '—');
  const productById = new Map(products.map((p) => [p.productId, p]));

  return (
    <div className="fade-in" style={{ paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
          <ScanLine size={28} style={{ color: 'var(--primary-color)' }} /> Scan & Book
        </h1>
        <button className="btn btn-outline" onClick={openReport} style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
          <CalendarClock size={16} /> Shipment report
        </button>
      </div>

      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
          <button className={`btn ${mode === 'type' ? 'btn-primary' : 'btn-outline'}`} onClick={() => changeMode('type')} style={{ flex: 1 }}>
            <Keyboard size={16} /> Type
          </button>
          <button className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-outline'}`} onClick={() => changeMode('camera')} style={{ flex: 1 }}>
            <Camera size={16} /> Camera
          </button>
        </div>

        {mode === 'type' ? (
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
        ) : loading ? (
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)' }}>Loading open orders…</div>
        ) : (
          <CameraScanner onDetected={onScan} />
        )}
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
                    {isAdmin(profile) && (
                      <button title="Edit" onClick={() => startEdit(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)' }}><Pencil size={16} /></button>
                    )}
                    {isAdmin(profile) && (
                      <button title="Void / cancel" onClick={() => voidOrder(s)} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)' }}><Ban size={16} /></button>
                    )}
                    <button title="Remove from this scan" onClick={() => removeScan(s.trackingId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
                  </div>
                </div>
                <p style={{ margin: '0.25rem 0', fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.trackingId}</p>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{s.receiverPincode} · {s.receiverState}</p>
                {crossGroup && s.groupName && (
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 600 }}>{s.groupName}</p>
                )}
                {(productById.get(s.productId)?.name || s.variant) && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {productById.get(s.productId)?.name || 'Product'}{s.variant ? ` · ${s.variant}` : ''}
                    {s.extraProductIds && s.extraProductIds.length > 0 ? ` +${s.extraProductIds.length}` : ''}
                  </p>
                )}
                {s.exportedAt && <span className="badge badge-processing" style={{ marginTop: '0.4rem', display: 'inline-block' }}>already exported</span>}
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
              <select className="input-field" value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value, variant: '' })}>
                {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
              </select>
            </div>
            {(productById.get(editForm.productId)?.variants || []).length > 0 && (
              <div className="input-group">
                <label className="input-label">Variant</label>
                <select className="input-field" value={editForm.variant} onChange={(e) => setEditForm({ ...editForm, variant: e.target.value })}>
                  <option value="">-- Choose variant --</option>
                  {(productById.get(editForm.productId)?.variants || []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showReport && (
        <ShipmentReportModal
          report={report} loading={reportLoading}
          from={reportFrom} to={reportTo}
          singleDay={crossGroup}
          onFrom={(v) => { setReportFrom(v); loadReport(v, reportTo); }}
          onTo={(v) => { setReportTo(v); loadReport(reportFrom, v); }}
          onDay={(v) => { setReportFrom(v); setReportTo(v); loadReport(v, v); }}
          onClose={() => setShowReport(false)}
        />
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

// Strip everything but letters/digits and uppercase — used to match a scanned
// barcode against stored tracking IDs regardless of stray spaces or case.
function normId(s: string): string {
  return String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  return arr.reduce((acc, x) => { const k = key(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
}

// Server-backed, group-wise SHIPPED report over a date range: each customer GROUP
// with shipments → its products (by nick name) → total + per-state counts. A
// superadmin spans every group; a scoped user sees only their own.
const ShipmentReportModal = ({ report, loading, from, to, singleDay, onFrom, onTo, onDay, onClose }: {
  report: ShipmentReport | null; loading: boolean; from: string; to: string; singleDay?: boolean;
  onFrom: (v: string) => void; onTo: (v: string) => void; onDay?: (v: string) => void; onClose: () => void;
}) => {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
      <div onClick={(e) => e.stopPropagation()} className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 820, background: 'white', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CalendarClock size={20} /> Shipment report</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>Shipped parcels (IST) — by group → product → state.</p>

        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
          {singleDay ? (
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Date
              <input type="date" className="input-field" value={from} max={todayIstDayKey()} onChange={(e) => onDay && onDay(e.target.value)} style={{ marginTop: '0.15rem' }} />
            </label>
          ) : (<>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>From
              <input type="date" className="input-field" value={from} max={to} onChange={(e) => onFrom(e.target.value)} style={{ marginTop: '0.15rem' }} />
            </label>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>To
              <input type="date" className="input-field" value={to} min={from} onChange={(e) => onTo(e.target.value)} style={{ marginTop: '0.15rem' }} />
            </label>
          </>)}
        </div>

        {loading ? <p style={{ color: 'var(--text-secondary)' }}>Loading…</p> : !report ? (
          <p style={{ color: 'var(--text-secondary)' }}>Couldn't load the report.</p>
        ) : report.total === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No shipments in this range.</p>
        ) : (
          <>
            <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.75rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Total{report.groups.length > 1 ? ` · ${report.groups.length} groups` : ''}</span><span>{report.total} shipped</span>
            </div>

            {report.groups.map((g) => (
              <div key={g.customerId} style={{ marginBottom: '1.4rem' }}>
                {/* Group header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', borderBottom: '2px solid var(--primary-color)', paddingBottom: '0.3rem', marginBottom: '0.7rem' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{g.name}</strong>
                  <span className="badge badge-completed" style={{ whiteSpace: 'nowrap' }}>{g.total} shipped</span>
                </div>
                {/* Product cards for this group — nick name + total + state counts */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
                  {g.products.map((p, i) => (
                    <div key={p.product + '|' + p.nickname + i} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem', background: 'var(--card-bg, white)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product}</div>
                          {p.nickname && p.nickname !== p.product && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--primary-color)', fontWeight: 600, fontSize: '0.78rem', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <Tag size={12} /> {p.nickname}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--primary-color)', lineHeight: 1.1 }}>
                          <span style={{ fontWeight: 800, fontSize: '1.35rem' }}>{p.total}</span>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>shipped</div>
                        </div>
                      </div>
                      <div style={{ marginTop: '0.6rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.55rem' }}>
                        <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>By state</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {Object.entries(p.states).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                            <span key={st} className="badge badge-primary" style={{ fontSize: '0.72rem' }}>{st}: {n}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
