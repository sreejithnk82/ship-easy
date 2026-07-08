import { useState } from 'react';
import { X, Download, Printer, Share2 } from 'lucide-react';
import type { Product } from '../lib/api';
import type { LabelOrder } from '../lib/labelModel';
import { LabelFormat, getLabelFormat, setLabelFormat } from '../lib/labelFormat';
import { LabelFormatPicker } from './LabelFormatPicker';
import { LabelTile } from './LabelTile';
import { downloadLabels, printLabels, buildLabelsFile, cleanName } from '../lib/labels';
import { useToast } from './feedback';

// One place to choose the label size, name the file, then Download / Share / Print
// — used for a freshly-generated batch, a whole history batch, or a single label.
// The size is remembered (getLabelFormat/setLabelFormat) so repeats are one tap.
export const LabelOutputModal = ({ labels, products, title, filename, onClose }: {
  labels: LabelOrder[]; products: Product[]; title: string; filename?: string; onClose: () => void;
}) => {
  const [fmt, setFmt] = useState<LabelFormat>(getLabelFormat());
  const [name, setName] = useState(filename || 'labels.pdf');
  const changeFmt = (f: LabelFormat) => { setFmt(f); setLabelFormat(f); };
  const notify = useToast();
  const first = labels[0];
  // Only show Share where the browser can share files (mobile / installed PWA).
  const canShareFiles = typeof (navigator as { canShare?: unknown }).canShare === 'function';

  const doDownload = () => downloadLabels(labels, products, fmt, cleanName(name));

  const doShare = async () => {
    const nav = navigator as unknown as {
      canShare?: (d: { files: File[] }) => boolean;
      share?: (d: { files: File[]; title?: string }) => Promise<void>;
    };
    const file = buildLabelsFile(labels, products, fmt, name);
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: cleanName(name) }); }
      catch { /* user cancelled the share sheet — nothing to do */ }
    } else {
      doDownload(); // e.g. desktop: no file-share → just download with the chosen name
      notify('Sharing not available here — downloaded instead.', 'info');
    }
  };

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
            <LabelTile order={first} products={products} fmt={fmt} scale={0.6} />
          </div>
        )}

        <div className="input-group" style={{ margin: '0.25rem 0 0' }}>
          <label className="input-label">File name</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="labels.pdf" />
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" style={{ flex: 1, minWidth: 110 }} onClick={() => printLabels(labels, products, fmt)}>
            <Printer size={18} /> Print
          </button>
          {canShareFiles && (
            <button className="btn btn-outline" style={{ flex: 1, minWidth: 110 }} onClick={doShare}>
              <Share2 size={18} /> Share
            </button>
          )}
          <button className="btn btn-primary" style={{ flex: 1, minWidth: 110 }} onClick={doDownload}>
            <Download size={18} /> Download
          </button>
        </div>
      </div>
    </div>
  );
};
