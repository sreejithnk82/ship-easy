// Build printable DTDC-style shipping labels as a PDF. The label artwork is laid
// out once in a reference 288×398pt box (drawLabel) and scaled into whatever
// paper size / per-page grid the user picked. Runs fully in the browser (jsPDF +
// JsBarcode), so it works offline once tracking IDs are in hand.

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Product } from './api';
import { triggerDownload } from './dtdc';
import { istDayKey } from './datetime';
import { buildLabelFields, LabelFields, LabelMeta } from './labelModel';
import type { LabelFormat, PaperKey } from './labelFormat';

export type { LabelOrder } from './labelModel';
import type { LabelOrder } from './labelModel';

// Page sizes in points (1in = 72pt).
const PAPER_PT: Record<PaperKey, [number, number]> = {
  a4: [595.28, 841.89],
  '4x6': [288, 432], '4x4': [288, 288], '4x3': [288, 216],
  '3x3': [216, 216], '3x2': [216, 144], '2x2': [144, 144],
};
// Labels-per-page → grid [cols, rows].
const GRID: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4] };

// Reference label geometry; everything in drawLabel is in these units.
const REF_W = 288;
const REF_H = 398;

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, height: 60, margin: 0 });
  return canvas.toDataURL('image/png');
}

/** Draw one DTDC-style label, scaled by `s` and offset to (ox, oy). */
function drawLabel(doc: jsPDF, f: LabelFields, ox: number, oy: number, s: number) {
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  const setF = (style: 'normal' | 'bold', size: number) => { doc.setFont('helvetica', style); doc.setFontSize(size * s); };
  const txt = (str: string, x: number, y: number, opts?: { align?: 'left' | 'center' | 'right'; baseline?: string }) =>
    doc.text(str || '', X(x), Y(y), opts as any);
  const hline = (x1: number, y: number, x2: number) => doc.line(X(x1), Y(y), X(x2), Y(y));
  const vline = (x: number, y1: number, y2: number) => doc.line(X(x), Y(y1), X(x), Y(y2));
  const rect = (x: number, y: number, w: number, h: number) => doc.rect(X(x), Y(y), w * s, h * s);
  // Wrapped text; returns the next reference-y.
  const wrap = (str: string, x: number, y: number, maxWRef: number, lhRef: number): number => {
    const lines = doc.splitTextToSize(str || '', maxWRef * s) as string[];
    lines.forEach((ln, i) => doc.text(ln, X(x), Y(y + i * lhRef)));
    return y + Math.max(1, lines.length) * lhRef;
  };

  doc.setDrawColor(0);
  doc.setLineWidth(Math.max(0.4, 0.8 * s));
  rect(1, 1, REF_W - 2, REF_H - 2);

  // ── A. Header: FROM | DTDC + ship meta ──
  vline(182, 1, 84);
  setF('bold', 8); txt('FROM:', 6, 13);
  setF('bold', 8.5); txt(f.fromName, 6, 24);
  setF('normal', 8);
  let y = 34;
  f.fromLines.forEach((l) => { y = wrap(l, 6, y, 170, 9.5); });
  setF('bold', 15); txt('DTDC', 188, 22);
  setF('normal', 8);
  txt(`Ship Date : ${f.shipDate}`, 188, 42);
  if (f.shipValue) txt(`Ship value : ${f.shipValue}`, 188, 54);
  hline(1, 84, REF_W - 1);

  // ── B. TO | barcode + prefix box ──
  vline(170, 84, 200);
  setF('bold', 8); txt('TO:', 6, 96);
  setF('bold', 10); let ty = wrap(f.toName, 6, 108, 158, 11);
  setF('normal', 9); f.toLines.forEach((l) => { ty = wrap(l, 6, ty, 158, 10.5); });
  // barcode
  try { doc.addImage(barcodeDataUrl(f.trackingId), 'PNG', X(176), Y(90), 106 * s, 26 * s); } catch { /* ignore */ }
  setF('bold', 9); txt(f.trackingId, 229, 126, { align: 'center' });
  // prefix / service letter box
  rect(206, 134, 48, 50);
  setF('bold', 34); txt(f.prefix, 230, 168, { align: 'center' });
  hline(1, 200, REF_W - 1);

  // ── C. Big destination pincode ──
  setF('bold', 28); txt(f.pincode, 6, 234);
  hline(1, 244, REF_W - 1);

  // ── D. Service | pieces ──
  vline(182, 244, 270);
  setF('bold', 12); txt(f.service, 6, 262);
  setF('bold', 9); txt(`Pcs: ${f.pcs}`, 188, 262);
  hline(1, 270, REF_W - 1);

  // ── E. Product description | ORG + payment ──
  vline(182, 270, 364);
  setF('bold', 9); txt('Product Description:', 6, 284);
  setF('normal', 9); wrap(f.productDesc, 6, 298, 172, 10.5);
  setF('normal', 7.5); txt('ORG', 234, 284, { align: 'center' });
  setF('bold', 17); txt(f.org, 234, 304, { align: 'center' });
  setF('normal', 9); txt('Prepaid', 234, 332, { align: 'center' });
  setF('bold', 9); txt("Don't collect money", 234, 346, { align: 'center' });
  hline(1, 364, REF_W - 1);

  // ── F. Footer: weight | booked-at ──
  setF('normal', 9); txt(`Weight: ${f.weight}`, 6, 382);
  setF('normal', 7.5); txt(f.bookedAt, REF_W - 6, 382, { align: 'right' });
}

/** Build a PDF laying labels out per the chosen paper size + per-page grid. */
export function buildLabelsPdf(orders: LabelOrder[], products: Product[], fmt: LabelFormat, meta?: LabelMeta): Blob {
  const byId = new Map(products.map((p) => [p.productId, p]));
  const [pw, ph] = PAPER_PT[fmt.paper] || PAPER_PT['4x6'];
  const [cols, rows] = GRID[fmt.perPage] || [1, 1];
  const perPage = cols * rows;
  const cellW = pw / cols;
  const cellH = ph / rows;

  const doc = new jsPDF({ unit: 'pt', format: [pw, ph] });

  orders.forEach((o, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage([pw, ph], 'portrait');
    const idx = i % perPage;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cx = col * cellW;
    const cy = row * cellH;
    const margin = Math.min(cellW, cellH) * 0.03;
    const scale = Math.min((cellW - 2 * margin) / REF_W, (cellH - 2 * margin) / REF_H);
    const ox = cx + (cellW - REF_W * scale) / 2;
    const oy = cy + (cellH - REF_H * scale) / 2;
    drawLabel(doc, buildLabelFields(o, byId.get(o.productId), meta), ox, oy, scale);
  });

  return doc.output('blob');
}

export function downloadLabels(
  orders: LabelOrder[],
  products: Product[],
  fmt: LabelFormat,
  filename?: string,
  meta?: LabelMeta,
) {
  const blob = buildLabelsPdf(orders, products, fmt, meta);
  triggerDownload(blob, filename || `labels_${istDayKey(new Date())}.pdf`);
}
