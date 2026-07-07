// Aspect-adaptive label layout engine. Given a content box (points) and the
// label data, it returns drawing PRIMITIVES positioned to FILL that box. Both
// the PDF (labels.ts) and the on-screen preview (LabelTile.tsx) render the same
// primitives, so they can't drift and every card aspect is handled in one place.
//
// Every band has a hard `maxLines` budget and the renderers truncate wrapped
// text to it, so bands NEVER overlap regardless of how long a field is.
//
// Priorities kept on every size: scannable barcode + tracking, ALL products
// (name + variant), receiver name, pincode, phone. Sender is name-only (dropped
// on tiny labels); receiver address is shown only where there's room. Roomy
// sizes carry TWO identical barcodes (a backup scan target); tiny sizes keep one.
//   • portrait  (w/h < 1.15, incl. squares) — two stacked barcodes, full-width bands
//   • wide      (w/h ≥ 1.15, e.g. 4×3, A4 2-up) — SINGLE column: barcode on top,
//                then items, ship-to, pincode. No side-by-side columns.
//   • minimal   (min side < 150pt) — barcode, products, name, pincode, phone

import type { LabelFields } from './labelModel';

export type LabelWeight = 'normal' | 'bold' | 'bolditalic';
export type LabelAlign = 'left' | 'center' | 'right';

export type LabelPrimitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; lineW: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; lineW: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: LabelWeight; align: LabelAlign; color?: string; maxW?: number; lineH?: number; maxLines?: number }
  | { kind: 'barcode'; x: number; y: number; w: number; h: number; value: string; align?: LabelAlign };

const BLUE = '#0d2d5f';
const GREY = '#64748b';

export function computeLabelLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  if (Math.min(w, h) < 150) return minimalLayout(w, h, f);
  if (w / h >= 1.15) return wideLayout(w, h, f);
  return portraitLayout(w, h, f);
}

function frame(w: number, h: number): LabelPrimitive[] {
  const lw = Math.max(0.4, Math.min(w, h) * 0.004);
  return [{ kind: 'rect', x: lw, y: lw, w: w - 2 * lw, h: h - 2 * lw, lineW: lw }];
}

function makeText(p: LabelPrimitive[]) {
  return (text: string, x: number, y: number, size: number, weight: LabelWeight,
          align: LabelAlign = 'left', opt: { color?: string; maxW?: number; lineH?: number; maxLines?: number } = {}) =>
    p.push({ kind: 'text', text: text || '', x, y, size, weight, align, ...opt });
}

function portraitLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.05;
  const x = pad, iw = w - 2 * pad, cx = w / 2;
  const lw = Math.max(0.3, h * 0.0025);
  const rule = (yy: number) => p.push({ kind: 'line', x1: pad, y1: yy, x2: w - pad, y2: yy, lineW: lw });
  const bar = (yy: number, hh: number, align: LabelAlign) => p.push({ kind: 'barcode', x: pad, y: yy, w: iw, h: hh, value: f.trackingId, align });

  // Header: DTDC + sender name (trimmed to name)
  T('DTDC', w - pad, h * 0.025, h * 0.05, 'bolditalic', 'right', { color: BLUE });
  T('From: ' + f.fromName, x, h * 0.03, h * 0.026, 'bold', 'left', { maxW: iw * 0.72, maxLines: 1 });
  rule(h * 0.07);

  // Barcode #1 — smaller, aligned to the RIGHT (a compact secondary scan target)
  bar(h * 0.08, h * 0.06, 'right');
  T(f.trackingId, w - pad, h * 0.145, h * 0.028, 'bold', 'right', { maxLines: 1 });
  rule(h * 0.185);

  // PRODUCTS — the large, prominent band (all items + variants)
  T('ITEMS', x, h * 0.20, h * 0.022, 'bold', 'left', { color: GREY });
  T(f.products.join('\n'), x, h * 0.235, h * 0.032, 'bold', 'left', { maxW: iw, lineH: h * 0.038, maxLines: 3 });
  rule(h * 0.37);

  // Barcode #2 — the primary, large, CENTERED barcode
  bar(h * 0.385, h * 0.105, 'center');
  T(f.trackingId, cx, h * 0.50, h * 0.036, 'bold', 'center', { maxLines: 1 });
  rule(h * 0.54);

  // SHIP TO — name, phone, address. Enlarged to use the space above the pincode
  // (the pincode is pushed to the bottom of the card, its size unchanged).
  T('Ship to:', x, h * 0.55, h * 0.022, 'bold', 'left', { color: GREY });
  T(f.toName, x, h * 0.578, h * 0.055, 'bold', 'left', { maxW: iw, maxLines: 1 });
  T('Ph: ' + f.phone, x, h * 0.645, h * 0.042, 'bold', 'left', { maxLines: 1 });
  T(f.addrLines.join('\n'), x, h * 0.70, h * 0.034, 'normal', 'left', { maxW: iw, lineH: h * 0.041, maxLines: 2 });

  // Destination pincode + state — moved to the bottom of the card
  T('PIN', x, h * 0.815, h * 0.022, 'bold', 'left', { color: GREY });
  T(f.pincode, x, h * 0.845, h * 0.10, 'bold', 'left', { maxLines: 1 });
  if (f.state) T(f.state, w - pad, h * 0.88, h * 0.04, 'bold', 'right', { maxW: iw * 0.5, maxLines: 1 });
  return p;
}

// Wide cells (4×3, A4 2-up). SINGLE column that flows top→bottom like a normal
// shipping label — NOT split into two side-by-side columns. Fraction-based, so
// the same proportions hold for a small 4×3 and a large A4 half-sheet.
function wideLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.055;
  const x = pad, iw = w - 2 * pad, cx = w / 2;
  const lw = Math.max(0.3, h * 0.004);
  const rule = (yy: number) => p.push({ kind: 'line', x1: pad, y1: yy, x2: w - pad, y2: yy, lineW: lw });

  // Header: DTDC + sender name (name only)
  T('DTDC', w - pad, h * 0.03, h * 0.05, 'bolditalic', 'right', { color: BLUE });
  T('From: ' + f.fromName, x, h * 0.035, h * 0.032, 'bold', 'left', { maxW: iw * 0.72, maxLines: 1 });
  rule(h * 0.10);

  // One prominent, full-width, centered barcode + its tracking number
  p.push({ kind: 'barcode', x: pad, y: h * 0.115, w: iw, h: h * 0.185, value: f.trackingId, align: 'center' });
  T(f.trackingId, cx, h * 0.31, h * 0.045, 'bold', 'center', { maxLines: 1 });
  rule(h * 0.37);

  // PRODUCTS — all items + variants
  T('ITEMS', x, h * 0.385, h * 0.028, 'bold', 'left', { color: GREY });
  T(f.products.join('\n'), x, h * 0.415, h * 0.042, 'bold', 'left', { maxW: iw, lineH: h * 0.05, maxLines: 2 });
  rule(h * 0.53);

  // SHIP TO — name / phone / address
  T('Ship to:', x, h * 0.545, h * 0.026, 'bold', 'left', { color: GREY });
  T(f.toName, x, h * 0.575, h * 0.055, 'bold', 'left', { maxW: iw, maxLines: 1 });
  T('Ph: ' + f.phone, x, h * 0.645, h * 0.04, 'bold', 'left', { maxLines: 1 });
  T(f.addrLines.join('\n'), x, h * 0.70, h * 0.032, 'normal', 'left', { maxW: iw, lineH: h * 0.038, maxLines: 2 });

  // Destination pincode + state — bottom of the card
  T('PIN', x, h * 0.80, h * 0.026, 'bold', 'left', { color: GREY });
  T(f.pincode, x, h * 0.83, h * 0.095, 'bold', 'left', { maxLines: 1 });
  if (f.state) T(f.state, w - pad, h * 0.85, h * 0.045, 'bold', 'right', { maxW: iw * 0.5, maxLines: 1 });
  return p;
}

function minimalLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.06;
  const x = pad, iw = w - 2 * pad, cx = w / 2;

  p.push({ kind: 'barcode', x, y: h * 0.07, w: iw, h: h * 0.20, value: f.trackingId });
  T(f.trackingId, cx, h * 0.30, h * 0.07, 'bold', 'center', { maxLines: 1 });
  T(f.products.join('\n'), x, h * 0.40, h * 0.06, 'bold', 'left', { maxW: iw, lineH: h * 0.072, maxLines: 2 });
  T(f.toName, x, h * 0.57, h * 0.062, 'bold', 'left', { maxW: iw, maxLines: 1 });
  T(f.pincode, x, h * 0.70, h * 0.12, 'bold', 'left', { maxLines: 1 });
  T('Ph: ' + f.phone, w - pad, h * 0.60, h * 0.05, 'normal', 'right', { maxLines: 1 });
  return p;
}
