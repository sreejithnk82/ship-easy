// Build printable DTDC shipping labels as a PDF. The label is laid out once in a
// reference 288×400pt box (drawLabel) and scaled into whatever paper size /
// per-page grid the user picked. Runs fully in the browser (jsPDF + JsBarcode),
// so it works offline once tracking IDs are in hand.

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Product } from './api';
import { triggerDownload } from './dtdc';
import { istDayKey } from './datetime';
import { buildLabelFields, LabelFields } from './labelModel';
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
const REF_H = 400;

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value || ' ', { format: 'CODE128', displayValue: false, height: 60, margin: 0 });
  return canvas.toDataURL('image/png');
}

/** Draw one DTDC label, scaled by `s` and offset to (ox, oy). */
function drawLabel(doc: jsPDF, f: LabelFields, ox: number, oy: number, s: number) {
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  const setF = (style: 'normal' | 'bold' | 'bolditalic', size: number) => { doc.setFont('helvetica', style); doc.setFontSize(size * s); };
  const txt = (str: string, x: number, y: number, opts?: { align?: 'left' | 'center' | 'right' }) =>
    doc.text(str || '', X(x), Y(y), opts as any);
  const hline = (y: number) => doc.line(X(1), Y(y), X(REF_W - 1), Y(y));
  const wrap = (str: string, x: number, y: number, maxWRef: number, lhRef: number): number => {
    const lines = doc.splitTextToSize(str || '', maxWRef * s) as string[];
    lines.forEach((ln, i) => doc.text(ln, X(x), Y(y + i * lhRef)));
    return y + Math.max(1, lines.length) * lhRef;
  };

  doc.setDrawColor(0);
  doc.setLineWidth(Math.max(0.4, 0.8 * s));
  doc.rect(X(1), Y(1), (REF_W - 2) * s, (REF_H - 2) * s);

  // ── Header: DTDC mark ──
  doc.setTextColor(13, 45, 95);
  setF('bolditalic', 26); txt('DTDC', REF_W - 12, 40, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  hline(58);

  // ── From ──
  setF('bold', 13); txt('From:', 12, 84);
  setF('bold', 9); txt(f.fromName, 12, 102);
  setF('normal', 8.5);
  let y = 114;
  f.fromLines.forEach((l) => { y = wrap(l, 12, y, 264, 11); });
  hline(150);

  // ── Barcode + tracking id (top-right of the middle band) ──
  try { doc.addImage(barcodeDataUrl(f.trackingId), 'PNG', X(150), Y(162), 130 * s, 30 * s); } catch { /* ignore */ }
  setF('bold', 11); txt(f.trackingId, 215, 204, { align: 'center' });

  // ── To ──
  setF('bold', 13); txt('To:', 12, 214);
  setF('bold', 13); txt(f.toName, 12, 240);
  setF('normal', 11.5);
  let ty = 260;
  f.toLines.forEach((l) => { ty = wrap(l, 12, ty, 264, 16); });

  // ── Big destination pincode ──
  setF('bold', 28); txt(f.pincode, 12, 348);
  hline(362);

  // ── Product name ──
  setF('normal', 12); wrap(f.productName, 12, 384, 264, 14);
}

/** Build a PDF laying labels out per the chosen paper size + per-page grid. */
export function buildLabelsPdf(orders: LabelOrder[], products: Product[], fmt: LabelFormat): Blob {
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
    drawLabel(doc, buildLabelFields(o, byId.get(o.productId)), ox, oy, scale);
  });

  return doc.output('blob');
}

export function downloadLabels(orders: LabelOrder[], products: Product[], fmt: LabelFormat, filename?: string) {
  const blob = buildLabelsPdf(orders, products, fmt);
  triggerDownload(blob, filename || `labels_${istDayKey(new Date())}.pdf`);
}
