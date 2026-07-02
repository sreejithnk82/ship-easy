// Build printable DTDC shipping labels as a PDF. The label is laid out once in a
// reference 288×432pt box (4×6 aspect, so it fills a 4×6 thermal sheet) and
// scaled into whatever paper size / per-page grid the user picked. Runs fully in
// the browser (jsPDF + JsBarcode), so it works offline once tracking IDs are in hand.

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

// Reference label geometry; everything in drawLabel is in these units. Matches
// the 4×6 (2:3) label aspect so the design fills a 4×6 thermal sheet edge-to-edge.
const REF_W = 288;
const REF_H = 432;

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas');
  // Tall render so the wide, scaled-up barcode on the label stays crisp.
  JsBarcode(canvas, value || ' ', { format: 'CODE128', displayValue: false, height: 80, margin: 0 });
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
  setF('bolditalic', 30); txt('DTDC', REF_W - 14, 40, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  hline(52);

  // ── From (compact) ──
  setF('bold', 11); txt('FROM:', 14, 71);
  setF('bold', 9.5); txt(f.fromName, 14, 87);
  setF('normal', 8.5);
  let y = 99;
  f.fromLines.forEach((l) => { y = wrap(l, 14, y, 260, 11); });
  hline(132);

  // ── Barcode + tracking id (large, centered) ──
  try { doc.addImage(barcodeDataUrl(f.trackingId), 'PNG', X(24), Y(144), 240 * s, 48 * s); } catch { /* ignore */ }
  setF('bold', 15); txt(f.trackingId, REF_W / 2, 205, { align: 'center' });
  hline(214);

  // ── To (the focus — bold receiver) ──
  setF('bold', 12); txt('TO:', 14, 234);
  setF('bold', 16); txt(f.toName, 14, 256);
  setF('normal', 12.5);
  let ty = 278;
  f.toLines.forEach((l) => { ty = wrap(l, 14, ty, 260, 15); });

  // ── Big destination pincode ──
  setF('bold', 10); txt('PIN', 14, 344);
  setF('bold', 38); txt(f.pincode, 14, 382);
  hline(392);

  // ── Product name ──
  setF('normal', 11); wrap(f.productName, 14, 411, 260, 13);
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
