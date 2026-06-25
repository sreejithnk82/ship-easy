import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../lib/api';
import { buildLabelFields, LabelOrder, LabelMeta } from '../lib/labelModel';

// A fixed-layout on-screen preview of the DTDC-style label. Mirrors the geometry
// of drawLabel() in labels.ts (reference 288×398) so what you see ≈ the PDF.

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
const H = 398;

const Abs = ({ l, t, w, size, bold, align, children }: {
  l: number; t: number; w?: number; size: number; bold?: boolean; align?: 'left' | 'center' | 'right'; children: React.ReactNode;
}) => (
  <div style={{ position: 'absolute', left: l, top: t, width: w, fontSize: size, lineHeight: 1.15, fontWeight: bold ? 700 : 400, textAlign: align, whiteSpace: w ? 'normal' : 'nowrap', overflow: 'hidden' }}>
    {children}
  </div>
);
const HLine = ({ t }: { t: number }) => <div style={{ position: 'absolute', left: 0, top: t, width: W, borderTop: '1px solid #000' }} />;
const VLine = ({ l, t, h }: { l: number; t: number; h: number }) => <div style={{ position: 'absolute', left: l, top: t, height: h, borderLeft: '1px solid #000' }} />;

export const LabelTile = ({ order, product, meta, scale = 1 }: {
  order: LabelOrder; product?: Product; meta?: LabelMeta; scale?: number;
}) => {
  const f = buildLabelFields(order, product, meta);
  const bc = useMemo(() => barcode(f.trackingId), [f.trackingId]);

  return (
    <div style={{ width: W * scale, height: H * scale, flex: '0 0 auto' }}>
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', boxSizing: 'border-box', border: '1px solid #000', position: 'relative', background: '#fff', color: '#000', fontFamily: 'Helvetica, Arial, sans-serif', overflow: 'hidden' }}>
        {/* A. header */}
        <VLine l={182} t={0} h={84} />
        <Abs l={6} t={6} size={8} bold>FROM:</Abs>
        <Abs l={6} t={17} w={170} size={9} bold>{f.fromName}</Abs>
        <Abs l={6} t={30} w={172} size={8.5}>{f.fromLines.join(', ')}</Abs>
        <Abs l={188} t={6} size={15} bold>DTDC</Abs>
        <Abs l={188} t={34} size={8}>Ship Date : {f.shipDate}</Abs>
        {f.shipValue && <Abs l={188} t={46} size={8}>Ship value : {f.shipValue}</Abs>}
        <HLine t={84} />

        {/* B. TO + barcode */}
        <VLine l={170} t={84} h={116} />
        <Abs l={6} t={88} size={8} bold>TO:</Abs>
        <Abs l={6} t={100} w={158} size={10} bold>{f.toName}</Abs>
        <Abs l={6} t={132} w={158} size={9}>{f.toLines.join(', ')}</Abs>
        {bc && <img src={bc} alt="" style={{ position: 'absolute', left: 176, top: 90, width: 106, height: 26 }} />}
        <Abs l={170} t={120} w={114} size={9} bold align="center">{f.trackingId}</Abs>
        <div style={{ position: 'absolute', left: 206, top: 134, width: 48, height: 50, border: '1px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 700 }}>{f.prefix}</div>
        <HLine t={200} />

        {/* C. pincode */}
        <Abs l={6} t={208} size={28} bold>{f.pincode}</Abs>
        <HLine t={244} />

        {/* D. service / pcs */}
        <VLine l={182} t={244} h={26} />
        <Abs l={6} t={250} size={12} bold>{f.service}</Abs>
        <Abs l={188} t={252} size={9} bold>Pcs: {f.pcs}</Abs>
        <HLine t={270} />

        {/* E. product / org / payment */}
        <VLine l={182} t={270} h={94} />
        <Abs l={6} t={276} size={9} bold>Product Description:</Abs>
        <Abs l={6} t={290} w={172} size={9}>{f.productDesc}</Abs>
        <Abs l={184} t={276} w={100} size={7.5} align="center">ORG</Abs>
        <Abs l={184} t={286} w={100} size={17} bold align="center">{f.org}</Abs>
        <Abs l={184} t={322} w={100} size={9} align="center">Prepaid</Abs>
        <Abs l={184} t={336} w={100} size={9} bold align="center">Don't collect money</Abs>
        <HLine t={364} />

        {/* F. footer */}
        <Abs l={6} t={373} size={9}>Weight: {f.weight}</Abs>
        <Abs l={150} t={374} w={132} size={7.5} align="right">{f.bookedAt}</Abs>
      </div>
    </div>
  );
};
