import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../lib/api';
import { buildLabelFields, LabelOrder } from '../lib/labelModel';
import { labelGeometry, LabelFormat } from '../lib/labelFormat';
import { computeLabelLayout, LabelPrimitive } from '../lib/labelLayout';

// On-screen preview of a label. Renders the SAME primitives as the PDF
// (computeLabelLayout), for the chosen format's single-cell box — so what you
// see matches the print. Points are used as px; the `scale` prop shrinks it.

function barcode(value: string): string {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || ' ', { format: 'CODE128', displayValue: false, height: 80, margin: 0 });
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

const DEFAULT_FMT: LabelFormat = { paper: '4x6', perPage: 1 };

// One primitive → an absolutely-positioned element (mirrors renderPrimitives in labels.ts).
const Prim = ({ p, bc }: { p: LabelPrimitive; bc: string }) => {
  if (p.kind === 'rect') {
    return <div style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, border: `${p.lineW}px solid #000`, boxSizing: 'border-box' }} />;
  }
  if (p.kind === 'line') {
    const vertical = p.x1 === p.x2;
    return <div style={{ position: 'absolute', left: p.x1, top: p.y1, width: vertical ? 0 : p.x2 - p.x1, height: vertical ? p.y2 - p.y1 : 0, borderTop: vertical ? undefined : `${p.lineW}px solid #000`, borderLeft: vertical ? `${p.lineW}px solid #000` : undefined }} />;
  }
  if (p.kind === 'barcode') {
    // objectFit contain preserves the barcode's aspect ratio (no stretching);
    // top-aligned, and horizontally placed to match the PDF's align.
    const pos = p.align === 'right' ? 'right top' : p.align === 'left' ? 'left top' : 'top';
    return bc ? <img src={bc} alt="" style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, objectFit: 'contain', objectPosition: pos }} /> : null;
  }
  // text: p.y is the top; center/right anchor at p.x via transform.
  const style: React.CSSProperties = {
    position: 'absolute', top: p.y, fontSize: p.size,
    fontWeight: p.weight === 'normal' ? 400 : 700,
    fontStyle: p.weight === 'bolditalic' ? 'italic' : 'normal',
    color: p.color || '#000', textAlign: p.align,
    lineHeight: `${p.lineH ?? p.size * 1.15}px`,
  };
  if (p.maxW && p.align === 'left') {
    style.left = p.x; style.width = p.maxW; style.whiteSpace = 'pre-line';
    if (p.maxLines) { // clamp so the preview matches the PDF's line budget (no overlap)
      style.display = '-webkit-box'; (style as any).WebkitBoxOrient = 'vertical';
      (style as any).WebkitLineClamp = p.maxLines; style.overflow = 'hidden';
      style.maxHeight = (p.lineH ?? p.size * 1.15) * p.maxLines;
    }
  } else if (p.align === 'center') {
    style.left = p.x; style.transform = 'translateX(-50%)'; style.whiteSpace = 'nowrap';
  } else if (p.align === 'right') {
    style.left = p.x; style.transform = 'translateX(-100%)'; style.whiteSpace = 'nowrap';
  } else {
    style.left = p.x; style.whiteSpace = 'nowrap';
  }
  return <div style={style}>{p.text}</div>;
};

export const LabelTile = ({ order, products, scale = 1, fmt }: { order: LabelOrder; products: Product[]; scale?: number; fmt?: LabelFormat }) => {
  const use = fmt ?? DEFAULT_FMT;
  const g = labelGeometry(use);
  const boxW = g.cellW, boxH = g.cellH;

  const byId = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products]);
  const f = buildLabelFields(order, byId);
  const prims = useMemo(() => computeLabelLayout(boxW, boxH, f), [boxW, boxH, f.trackingId, f.toName, f.pincode, f.products.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const bc = useMemo(() => barcode(f.trackingId), [f.trackingId]);

  return (
    <div style={{ width: boxW * scale, height: boxH * scale, flex: '0 0 auto', overflow: 'hidden' }}>
      <div style={{ width: boxW, height: boxH, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative', background: '#fff', color: '#000', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        {prims.map((p, i) => <Prim key={i} p={p} bc={bc} />)}
      </div>
    </div>
  );
};
