import { useState } from 'react';
import { X, Download, Printer } from 'lucide-react';
import type { Product } from '../lib/api';
import type { LabelOrder } from '../lib/labelModel';
import { LabelFormat, getLabelFormat, setLabelFormat } from '../lib/labelFormat';
import { LabelFormatPicker } from './LabelFormatPicker';
import { LabelTile } from './LabelTile';
import { downloadLabels, printLabels } from '../lib/labels';

// One place to choose the label size and then Download or Print — used for a
// freshly-generated batch, a whole history batch, or a single label. The size is
// remembered (getLabelFormat/setLabelFormat) so repeat outputs are one tap.
export const LabelOutputModal = ({ labels, products, title, filename, onClose }: {
  labels: LabelOrder[]; products: Product[]; title: string; filename?: string; onClose: () => void;
}) => {
  const [fmt, setFmt] = useState<LabelFormat>(getLabelFormat());
  const changeFmt = (f: LabelFormat) => { setFmt(f); setLabelFormat(f); };
  const productById = new Map(products.map((p) => [p.productId, p]));
  const first = labels[0];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
      <div onClick={(e) => e.stopPropagation()} className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 520, background: 'white', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {labels.length} label{labels.length === 1 ? '' : 's'} · choose the size
        </p>
        <LabelFormatPicker value={fmt} onChange={changeFmt} />

        {first && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0', overflow: 'auto' }}>
            <LabelTile order={first} product={productById.get(first.productId)} fmt={fmt} scale={0.6} />
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => printLabels(labels, products, fmt)}>
            <Printer size={18} /> Print
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => downloadLabels(labels, products, fmt, filename)}>
            <Download size={18} /> Download
          </button>
        </div>
      </div>
    </div>
  );
};
