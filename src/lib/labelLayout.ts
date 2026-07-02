// Aspect-adaptive label layout engine. Given a content box (points) and the
// label data, it returns drawing PRIMITIVES positioned to FILL that box. Both
// the PDF (labels.ts) and the on-screen preview (LabelTile.tsx) render the same
// primitives, so they can't drift and every card aspect is handled in one place.
//
// Three modes, chosen from the box so it always fills:
//   • portrait  (w/h < 1.15, incl. squares) — stacked bands
//   • landscape (w/h ≥ 1.15)                — two columns
//   • minimal   (min side < 150pt, tiny)    — barcode + tracking + name + pincode

import type { LabelFields } from './labelModel';

export type LabelWeight = 'normal' | 'bold' | 'bolditalic';
export type LabelAlign = 'left' | 'center' | 'right';

export type LabelPrimitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; lineW: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; lineW: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: LabelWeight; align: LabelAlign; color?: string; maxW?: number; lineH?: number }
  | { kind: 'barcode'; x: number; y: number; w: number; h: number; value: string };

const BLUE = '#0d2d5f';

export function computeLabelLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  if (Math.min(w, h) < 150) return minimalLayout(w, h, f);
  if (w / h >= 1.15) return landscapeLayout(w, h, f);
  return portraitLayout(w, h, f);
}

function frame(w: number, h: number): LabelPrimitive[] {
  const lw = Math.max(0.4, Math.min(w, h) * 0.004);
  return [{ kind: 'rect', x: lw, y: lw, w: w - 2 * lw, h: h - 2 * lw, lineW: lw }];
}

// A tiny push-helper factory bound to a primitives array.
function makeText(p: LabelPrimitive[]) {
  return (text: string, x: number, y: number, size: number, weight: LabelWeight,
          align: LabelAlign = 'left', opt: { color?: string; maxW?: number; lineH?: number } = {}) =>
    p.push({ kind: 'text', text: text || '', x, y, size, weight, align, ...opt });
}

function portraitLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.05;
  const x = pad, iw = w - 2 * pad, cx = w / 2;
  const lw = Math.max(0.3, h * 0.0025);
  const rule = (yy: number) => p.push({ kind: 'line', x1: pad, y1: yy, x2: w - pad, y2: yy, lineW: lw });

  T('DTDC', w - pad, h * 0.035, h * 0.075, 'bolditalic', 'right', { color: BLUE });
  rule(h * 0.115);

  T('FROM:', x, h * 0.14, h * 0.03, 'bold');
  T(f.fromName, x, h * 0.175, h * 0.03, 'bold', 'left', { maxW: iw });
  T(f.fromLines.join('\n'), x, h * 0.215, h * 0.025, 'normal', 'left', { maxW: iw, lineH: h * 0.03 });
  rule(h * 0.30);

  p.push({ kind: 'barcode', x: w * 0.12, y: h * 0.325, w: w * 0.76, h: h * 0.115, value: f.trackingId });
  T(f.trackingId, cx, h * 0.46, h * 0.04, 'bold', 'center');
  rule(h * 0.505);

  T('TO:', x, h * 0.53, h * 0.03, 'bold');
  T(f.toName, x, h * 0.565, h * 0.05, 'bold', 'left', { maxW: iw });
  T(f.toLines.join('\n'), x, h * 0.635, h * 0.034, 'normal', 'left', { maxW: iw, lineH: h * 0.04 });

  T('PIN', x, h * 0.795, h * 0.026, 'bold');
  T(f.pincode, x, h * 0.825, h * 0.10, 'bold');
  rule(h * 0.93);

  T(f.productName, x, h * 0.945, h * 0.028, 'normal', 'left', { maxW: iw, lineH: h * 0.032 });
  return p;
}

function landscapeLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.06;
  const lw = Math.max(0.3, h * 0.004);
  const colX = w * 0.55;
  const lx = pad, lW = colX - 2 * pad;
  const rx = colX + pad, rW = w - rx - pad;

  T('DTDC', w - pad, h * 0.05, h * 0.10, 'bolditalic', 'right', { color: BLUE });
  p.push({ kind: 'line', x1: colX, y1: pad, x2: colX, y2: h * 0.84, lineW: lw });

  // Left column: From (top) + To (below, bold)
  T('FROM:', lx, h * 0.07, h * 0.05, 'bold');
  T(f.fromName, lx, h * 0.145, h * 0.05, 'bold', 'left', { maxW: lW });
  T(f.fromLines.join('\n'), lx, h * 0.22, h * 0.045, 'normal', 'left', { maxW: lW, lineH: h * 0.055 });
  T('TO:', lx, h * 0.46, h * 0.05, 'bold');
  T(f.toName, lx, h * 0.54, h * 0.075, 'bold', 'left', { maxW: lW });
  T(f.toLines.join('\n'), lx, h * 0.66, h * 0.05, 'normal', 'left', { maxW: lW, lineH: h * 0.06 });

  // Right column: barcode + tracking + big pincode
  p.push({ kind: 'barcode', x: rx, y: h * 0.17, w: rW, h: h * 0.20, value: f.trackingId });
  T(f.trackingId, rx + rW / 2, h * 0.41, h * 0.055, 'bold', 'center');
  T('PIN', rx, h * 0.55, h * 0.05, 'bold');
  T(f.pincode, rx, h * 0.61, h * 0.13, 'bold', 'left', { maxW: rW });

  // Bottom strip: product across full width
  p.push({ kind: 'line', x1: pad, y1: h * 0.85, x2: w - pad, y2: h * 0.85, lineW: lw });
  T(f.productName, pad, h * 0.875, h * 0.05, 'normal', 'left', { maxW: w - 2 * pad });
  return p;
}

function minimalLayout(w: number, h: number, f: LabelFields): LabelPrimitive[] {
  const p = frame(w, h);
  const T = makeText(p);
  const pad = Math.min(w, h) * 0.06;
  const cx = w / 2;

  T('DTDC', w - pad, h * 0.05, h * 0.09, 'bolditalic', 'right', { color: BLUE });
  p.push({ kind: 'barcode', x: pad, y: h * 0.15, w: w - 2 * pad, h: h * 0.22, value: f.trackingId });
  T(f.trackingId, cx, h * 0.40, h * 0.075, 'bold', 'center');
  T(f.toName, pad, h * 0.53, h * 0.09, 'bold', 'left', { maxW: w - 2 * pad });
  T(f.pincode, pad, h * 0.72, h * 0.16, 'bold');
  return p;
}
