import { useState, useEffect } from 'react';
import { History as HistoryIcon, Download, ChevronDown, ChevronRight, Package, WifiOff, MessageCircle, CalendarDays, Copy } from 'lucide-react';
import { api, OrderRow, Product } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { listBatches, SavedBatch } from '../lib/outbox';
import { downloadLabels } from '../lib/labels';
import { getLabelFormat, setLabelFormat, LabelFormat } from '../lib/labelFormat';
import { LabelFormatPicker } from '../components/LabelFormatPicker';
import { istDayKey, istDateLabel, istTimeLabel, istDateTimeLabel, todayIstDayKey } from '../lib/datetime';
import { whatsappShareLink, shipmentMessage } from '../lib/share';
import { useToast } from '../components/feedback';

type UiLabel = {
  trackingId: string; productId: string;
  receiverName: string; receiverPhone: string; receiverPincode: string;
  receiverLine1: string; receiverLine2: string; receiverState?: string;
  status?: string; exportedAt?: string; shippedAt?: string;
};
type UiBatch = { batchId: string; createdAt: number; labels: UiLabel[]; products: Product[] };

// Treat a "YYYY-MM-DD" day key as midnight IST for labelling.
const dayAsIst = (day: string) => `${day}T00:00:00+05:30`;

export const History = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;

  const [products, setProducts] = useState<Product[]>([]);
  const [serverOrders, setServerOrders] = useState<OrderRow[] | null>(null); // null = offline
  const [localBatches, setLocalBatches] = useState<SavedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<string>(todayIstDayKey());
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [fmt, setFmt] = useState<LabelFormat>(getLabelFormat());

  const changeFmt = (f: LabelFormat) => { setFmt(f); setLabelFormat(f); };

  useEffect(() => { if (customerId) load(); else setLoading(false); }, [customerId]);

  const load = async () => {
    setLoading(true);
    setLocalBatches(await listBatches(customerId));
    try {
      const [{ orders }, prods] = await Promise.all([
        api.listOrders(customerId, 1000),
        api.listProducts(customerId),
      ]);
      setServerOrders(orders);
      setProducts(prods.products);
    } catch {
      setServerOrders(null); // offline → render this device's cache instead
    } finally {
      setLoading(false);
    }
  };

  const productName = (id: string) =>
    products.find((p) => p.productId === id)?.name
    || localBatches.flatMap((b) => b.products).find((p) => p.productId === id)?.name
    || 'Unknown product';

  // Build batches from the server (rich + live status, preferred) or the local cache.
  let allBatches: UiBatch[];
  if (serverOrders !== null) {
    const byBatch = new Map<string, UiBatch>();
    for (const o of serverOrders) {
      const id = o.batchId || o.orderId;
      let b = byBatch.get(id);
      if (!b) { b = { batchId: id, createdAt: Date.parse(o.createdAt) || 0, labels: [], products }; byBatch.set(id, b); }
      b.labels.push({
        trackingId: o.trackingId, productId: o.productId, status: o.status,
        receiverName: o.receiverName, receiverPhone: o.receiverPhone, receiverPincode: o.receiverPincode,
        receiverLine1: o.receiverLine1, receiverLine2: o.receiverLine2, receiverState: o.receiverState,
        exportedAt: o.exportedAt, shippedAt: o.shippedAt,
      });
    }
    allBatches = [...byBatch.values()];
  } else {
    allBatches = localBatches.map((b) => ({ batchId: b.batchId, createdAt: b.createdAt, products: b.products, labels: b.labels.map((l) => ({ ...l })) }));
  }

  // Only the chosen IST day, newest first.
  const batches = allBatches
    .filter((b) => istDayKey(b.createdAt) === day)
    .sort((a, b) => b.createdAt - a.createdAt);

  const regenerate = (b: UiBatch) =>
    downloadLabels(b.labels, b.products, fmt, `labels_${b.batchId.slice(0, 8)}.pdf`);

  if (!customerId) {
    return <div className="fade-in"><h1 className="page-title">Label History</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to view history.</p></div>;
  }

  return (
    <div className="fade-in" style={{ paddingBottom: '5rem' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <HistoryIcon size={28} style={{ color: 'var(--primary-color)' }} /> Label History
      </h1>

      <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <CalendarDays size={20} style={{ color: 'var(--primary-color)' }} />
        <label className="input-label" style={{ margin: 0 }}>Date (IST)</label>
        <input
          type="date"
          className="input-field"
          value={day}
          max={todayIstDayKey()}
          onChange={(e) => { setDay(e.target.value); setOpenBatch(null); }}
          style={{ width: 'auto', flex: '0 1 200px' }}
        />
        <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {istDateLabel(dayAsIst(day))}
          {serverOrders === null && <span title="Offline — showing this device's cache" style={{ display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}><WifiOff size={14} /></span>}
        </span>
      </div>

      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Label size for downloads</p>
        <LabelFormatPicker value={fmt} onChange={changeFmt} />
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      ) : batches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
          <Package size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>No labels generated on {istDateLabel(dayAsIst(day))}.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {batches.map((b) => {
            const expanded = openBatch === b.batchId;
            const n = b.labels.length;
            const shipped = b.labels.filter((l) => l.status === 'shipped').length;
            const voided = b.labels.filter((l) => l.status === 'void').length;
            return (
              <div key={b.batchId} className="glass-card" style={{ padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button onClick={() => setOpenBatch(expanded ? null : b.batchId)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: 0, flex: 1, textAlign: 'left' }}>
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span style={{ fontWeight: 600 }}>{n} label{n === 1 ? '' : 's'}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>· {istTimeLabel(b.createdAt)} · #{b.batchId.slice(0, 8)}</span>
                    {shipped > 0 && <span className="badge badge-completed">{shipped} shipped</span>}
                    {voided > 0 && <span className="badge badge-gray">{voided} void</span>}
                  </button>
                  <button className="btn btn-outline" onClick={() => regenerate(b)} style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                    <Download size={15} /> Labels
                  </button>
                </div>

                {expanded && (
                  <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                    {b.labels.map((l) => <LabelCard key={l.trackingId} l={l} productName={productName(l.productId)} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const LabelCard = ({ l, productName }: { l: UiLabel; productName: string }) => {
  const notify = useToast();
  // The share message announces the order as Shipped, so only offer it once shipped.
  const isShipped = l.status === 'shipped';
  const wa = isShipped ? whatsappShareLink(l.receiverPhone, l.trackingId) : null;
  const statusClass = l.status === 'shipped' ? 'badge-completed' : l.status === 'void' ? 'badge-gray' : 'badge-primary';

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(shipmentMessage(l.trackingId));
      notify('Tracking message copied.', 'success');
    } catch {
      notify('Copy failed — long-press to copy manually.', 'error');
    }
  };
  return (
    <div className="glass-card" style={{ padding: '1.1rem', borderLeft: `4px solid ${l.status === 'void' ? 'var(--text-secondary)' : 'var(--primary-color)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{l.receiverName}</h3>
        {l.status && <span className={`badge ${statusClass}`} style={{ textTransform: 'capitalize' }}>{l.status}</span>}
      </div>

      <div style={{ margin: '0.75rem 0', padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.07)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tracking ID (DTDC)</div>
        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.15rem', textDecoration: l.status === 'void' ? 'line-through' : 'none' }}>{l.trackingId}</div>
      </div>

      <Row label="Product" value={productName} />
      <Row label="Phone" value={l.receiverPhone} />
      <Row label="Address" value={[l.receiverLine1, l.receiverLine2].filter(Boolean).join(', ')} />
      <Row label="Pincode / State" value={[l.receiverPincode, l.receiverState].filter(Boolean).join(' · ')} />
      {l.exportedAt && <Row label="Exported" value={istDateTimeLabel(l.exportedAt)} />}
      {l.shippedAt && <Row label="Shipped" value={istDateTimeLabel(l.shippedAt)} />}

      {isShipped && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" className="btn" style={{ flex: 1, background: '#25D366', color: 'white', border: 'none', textDecoration: 'none' }}>
              <MessageCircle size={18} /> WhatsApp
            </a>
          ) : (
            <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>No valid phone for WhatsApp.</span>
          )}
          <button className="btn btn-outline" onClick={copyMessage} title="Copy the tracking message to share anywhere" style={{ width: 'auto' }}>
            <Copy size={16} /> Copy
          </button>
        </div>
      )}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', padding: '0.15rem 0' }}>
    <span style={{ color: 'var(--text-secondary)', minWidth: 110 }}>{label}</span>
    <span style={{ flex: 1, fontWeight: 500 }}>{value || '—'}</span>
  </div>
);
