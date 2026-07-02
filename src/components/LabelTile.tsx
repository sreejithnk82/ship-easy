import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../lib/api';
import { buildLabelFields, LabelOrder } from '../lib/labelModel';

// Fixed-layout on-screen preview of the DTDC label. Mirrors drawLabel() in
// labels.ts (reference 288×432) so what you see ≈ the PDF.

function barcode(value: string): string {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || ' ', { format: 'CODE128', displayValue: false, height: 80, margin: 0 });
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

const W = 288;
const H = 432;

const Abs = ({ l, t, w, size, bold, italic, color, align, children }: {
  l: number; t: number; w?: number; size: number; bold?: boolean; italic?: boolean; color?: string; align?: 'left' | 'center' | 'right'; children: React.ReactNode;
}) => (
  <div style={{ position: 'absolute', left: l, top: t, width: w, fontSize: size, lineHeight: 1.2, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', color, textAlign: align, whiteSpace: w ? 'pre-line' : 'nowrap' }}>
    {children}
  </div>
);

export const LabelTile = ({ order, product, scale = 1 }: { order: LabelOrder; product?: Product; scale?: number }) => {
  const f = buildLabelFields(order, product);
  const bc = useMemo(() => barcode(f.trackingId), [f.trackingId]);

  return (
    <div style={{ width: W * scale, height: H * scale, flex: '0 0 auto', overflow: 'hidden' }}>
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', boxSizing: 'border-box', border: '1px solid #000', position: 'relative', background: '#fff', color: '#000', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        {/* Header */}
        <Abs l={0} t={12} w={W - 14} size={30} bold italic color="#0d2d5f" align="right">DTDC</Abs>
        <div style={{ position: 'absolute', left: 0, top: 52, width: W, borderTop: '1px solid #000' }} />

        {/* From (compact) */}
        <Abs l={14} t={60} size={11} bold>FROM:</Abs>
        <Abs l={14} t={78} w={260} size={9.5} bold>{f.fromName}</Abs>
        <Abs l={14} t={91} w={260} size={8.5}>{f.fromLines.join('\n')}</Abs>
        <div style={{ position: 'absolute', left: 0, top: 132, width: W, borderTop: '1px solid #000' }} />

        {/* Barcode + tracking id (large, centered) */}
        {bc && <img src={bc} alt="" style={{ position: 'absolute', left: 24, top: 144, width: 240, height: 48 }} />}
        <Abs l={0} t={192} w={W} size={15} bold align="center">{f.trackingId}</Abs>
        <div style={{ position: 'absolute', left: 0, top: 214, width: W, borderTop: '1px solid #000' }} />

        {/* To (the focus) */}
        <Abs l={14} t={223} size={12} bold>TO:</Abs>
        <Abs l={14} t={240} w={260} size={16} bold>{f.toName}</Abs>
        <Abs l={14} t={266} w={260} size={12.5}>{f.toLines.join('\n')}</Abs>

        {/* Big pincode */}
        <Abs l={14} t={330} size={10} bold>PIN</Abs>
        <Abs l={14} t={345} size={38} bold>{f.pincode}</Abs>
        <div style={{ position: 'absolute', left: 0, top: 392, width: W, borderTop: '1px solid #000' }} />

        {/* Product */}
        <Abs l={14} t={400} w={260} size={11}>{f.productName}</Abs>
      </div>
    </div>
  );
};
