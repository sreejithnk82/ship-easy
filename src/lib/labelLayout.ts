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
//   • portrait  (w/h < 1.15, incl. squares)
//   • landscape (w/h ≥ 1.15) — receiver left, barcode + big product list right
//   • minimal   (min side < 150pt) — barcode, products, name, pincode, phone

import type { LabelFields } from './labelModel';

export type LabelWeight = 'normal' | 'bold' | 'bolditalic';
export type LabelAlign = 'left' | 'center' | 'right';

export type LabelPrimitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; lineW: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; lineW: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: LabelWeight; align: LabelAlign; color?: string; maxW?: number; lineH?: number; maxLines?: number }
  | { kind: 'barcode'; x: number; y: number; w: number; h: number; value: string };

const BLUE = '#0d2d5f';
const GREY = '#64748b';

export function computeLabelLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  if (Math.min(w, h) < 150) return minimalLayout(w, h, f);
  if (w / h >= 1.15) return landscapeLayout(w, h, f);
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
  const bar = (yy: number, hh: number) => p.push({ kind: 'barcode', x: w * 0.10, y: yy, w: w * 0.80, h: hh, value: f.trackingId });

  // Header: DTDC + sender name (trimmed to name)
  T('DTDC', w - pad, h * 0.025, h * 0.05, 'bolditalic', 'right', { color: BLUE });
  T('From: ' + f.fromName, x, h * 0.03, h * 0.026, 'bold', 'left', { maxW: iw * 0.72, maxLines: 1 });
  rule(h * 0.075);

  // Barcode #1 + tracking
  bar(h * 0.085, h * 0.085);
  T(f.trackingId, cx, h * 0.185, h * 0.034, 'bold', 'center', { maxLines: 1 });
  rule(h * 0.225);

  // PRODUCTS — the large, prominent band (all items + variants)
  T('ITEMS', x, h * 0.24, h * 0.022, 'bold', 'left', { color: GREY });
  T(f.products.join('\n'), x, h * 0.27, h * 0.033, 'bold', 'left', { maxW: iw, lineH: h * 0.04, maxLines: 3 });
  rule(h * 0.40);

  // Barcode #2 — identical copy, so a second scan target is always in reach
  bar(h * 0.41, h * 0.085);
  T(f.trackingId, cx, h * 0.51, h * 0.034, 'bold', 'center', { maxLines: 1 });
  rule(h * 0.55);

  // TO — name, phone, address
  T(f.toName, x, h * 0.565, h * 0.042, 'bold', 'left', { maxW: iw, maxLines: 1 });
  T('Ph: ' + f.phone, x, h * 0.615, h * 0.028, 'normal', 'left', { maxLines: 1 });
  T(f.addrLines.join('\n'), x, h * 0.65, h * 0.026, 'normal', 'left', { maxW: iw, lineH: h * 0.032, maxLines: 2 });

  // Big destination pincode
  T('PIN', x, h * 0.775, h * 0.022, 'bold', 'left', { color: GREY });
  T(f.pincode, x, h * 0.805, h * 0.095, 'bold', 'left', { maxLines: 1 });
  return p;
}

function landscapeLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.06;
  const lw = Math.max(0.3, h * 0.004);
  const colX = w * 0.48;
  const lx = pad, lW = colX - 2 * pad;
  const rx = colX + pad, rW = w - rx - pad;

  T('DTDC', w - pad, h * 0.05, h * 0.075, 'bolditalic', 'right', { color: BLUE });
  T('From: ' + f.fromName, lx, h * 0.05, h * 0.048, 'bold', 'left', { maxW: lW, maxLines: 1 });
  p.push({ kind: 'line', x1: colX, y1: pad, x2: colX, y2: h - pad, lineW: lw });

  // Left column: receiver (name / phone / address / big pincode)
  T(f.toName, lx, h * 0.20, h * 0.075, 'bold', 'left', { maxW: lW, maxLines: 1 });
  T('Ph: ' + f.phone, lx, h * 0.32, h * 0.05, 'normal', 'left', { maxLines: 1 });
  T(f.addrLines.join('\n'), lx, h * 0.41, h * 0.046, 'normal', 'left', { maxW: lW, lineH: h * 0.056, maxLines: 2 });
  T('PIN', lx, h * 0.63, h * 0.044, 'bold', 'left', { color: GREY });
  T(f.pincode, lx, h * 0.68, h * 0.14, 'bold', 'left', { maxLines: 1 });

  // Right column: TWO identical barcodes stacked (a second scan target), then items
  const bar = (yy: number) => p.push({ kind: 'barcode', x: rx, y: yy, w: rW, h: h * 0.14, value: f.trackingId });
  bar(h * 0.05);
  T(f.trackingId, rx + rW / 2, h * 0.205, h * 0.042, 'bold', 'center', { maxLines: 1 });
  bar(h * 0.27);
  T(f.trackingId, rx + rW / 2, h * 0.425, h * 0.042, 'bold', 'center', { maxLines: 1 });
  T('ITEMS', rx, h * 0.50, h * 0.04, 'bold', 'left', { color: GREY });
  T(f.products.join('\n'), rx, h * 0.55, h * 0.05, 'bold', 'left', { maxW: rW, lineH: h * 0.062, maxLines: 3 });
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
