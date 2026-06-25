import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../lib/api';
import { buildLabelFields, LabelOrder } from '../lib/labelModel';

// Fixed-layout on-screen preview of the DTDC label. Mirrors drawLabel() in
// labels.ts (reference 288×400) so what you see ≈ the PDF.

function barcode(value: string): string {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || ' ', { format: 'CODE128', displayValue: false, height: 60, margin: 0 });
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

const W = 288;
const H = 400;

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
        <Abs l={0} t={16} w={W - 12} size={26} bold italic color="#0d2d5f" align="right">DTDC</Abs>
        <div style={{ position: 'absolute', left: 0, top: 58, width: W, borderTop: '1px solid #000' }} />

        {/* From */}
        <Abs l={12} t={70} size={13} bold>From:</Abs>
        <Abs l={12} t={94} w={264} size={9} bold>{f.fromName}</Abs>
        <Abs l={12} t={108} w={264} size={8.5}>{f.fromLines.join('\n')}</Abs>
        <div style={{ position: 'absolute', left: 0, top: 150, width: W, borderTop: '1px solid #000' }} />

        {/* Barcode + tracking id */}
        {bc && <img src={bc} alt="" style={{ position: 'absolute', left: 150, top: 160, width: 130, height: 30 }} />}
        <Abs l={150} t={194} w={130} size={11} bold align="center">{f.trackingId}</Abs>

        {/* To */}
        <Abs l={12} t={204} size={13} bold>To:</Abs>
        <Abs l={12} t={228} w={264} size={13} bold>{f.toName}</Abs>
        <Abs l={12} t={250} w={264} size={11.5}>{f.toLines.join('\n')}</Abs>

        {/* Big pincode */}
        <Abs l={12} t={322} size={28} bold>{f.pincode}</Abs>
        <div style={{ position: 'absolute', left: 0, top: 362, width: W, borderTop: '1px solid #000' }} />

        {/* Product */}
        <Abs l={12} t={372} w={264} size={12}>{f.productDesc}</Abs>
      </div>
    </div>
  );
};
