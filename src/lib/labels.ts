// Build printable DTDC shipping labels as a PDF. The label layout is computed
// once per cell by computeLabelLayout() (aspect-adaptive) and rendered here into
// whatever paper size / per-page grid the user picked. Runs fully in the browser
// (jsPDF + JsBarcode), so it works offline once tracking IDs are in hand.

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Product } from './api';
import { triggerDownload } from './dtdc';
import { istDayKey } from './datetime';
import { buildLabelFields } from './labelModel';
import { labelGeometry, labelCellOrigin, type LabelFormat } from './labelFormat';
import { computeLabelLayout, LabelPrimitive } from './labelLayout';

export type { LabelOrder } from './labelModel';
import type { LabelOrder } from './labelModel';

// Render the barcode and return its natural pixel aspect ratio, so callers can
// place it WITHOUT stretching (non-uniform scaling ruins the bar widths).
function barcodeImage(value: string): { url: string; ratio: number } {
  const canvas = document.createElement('canvas');
  // Thick modules (width 3) + quiet zone (margin) → crisp, scannable bars.
  JsBarcode(canvas, value || ' ', { format: 'CODE128', displayValue: false, height: 50, width: 3, margin: 8 });
  return { url: canvas.toDataURL('image/png'), ratio: canvas.width / canvas.height };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/** Render one label's primitives into the box at (ox, oy) — all in points. */
function renderPrimitives(doc: jsPDF, prims: LabelPrimitive[], ox: number, oy: number) {
  doc.setDrawColor(0);
  prims.forEach((pr) => {
    if (pr.kind === 'rect') {
      doc.setLineWidth(pr.lineW);
      doc.rect(ox + pr.x, oy + pr.y, pr.w, pr.h);
    } else if (pr.kind === 'line') {
      doc.setLineWidth(pr.lineW);
      doc.line(ox + pr.x1, oy + pr.y1, ox + pr.x2, oy + pr.y2);
    } else if (pr.kind === 'barcode') {
      try {
        const { url, ratio } = barcodeImage(pr.value);
        // Fit inside the slot preserving aspect: fill the height, then clamp to
        // width if too wide. Aligned within the slot, top. Never stretched.
        let dh = pr.h, dw = dh * ratio;
        if (dw > pr.w) { dw = pr.w; dh = dw / ratio; }
        const dx = pr.align === 'right' ? ox + pr.x + pr.w - dw
          : pr.align === 'left' ? ox + pr.x
          : ox + pr.x + (pr.w - dw) / 2;
        doc.addImage(url, 'PNG', dx, oy + pr.y, dw, dh);
      } catch { /* ignore */ }
    } else {
      doc.setFont('helvetica', pr.weight);
      doc.setFontSize(pr.size);
      const [r, g, b] = pr.color ? hexToRgb(pr.color) : [0, 0, 0];
      doc.setTextColor(r, g, b);
      const baseline = oy + pr.y + pr.size * 0.8; // text y = top; jsPDF wants the baseline
      const anchorX = ox + pr.x;
      if (pr.maxW) {
        let lines = doc.splitTextToSize(pr.text, pr.maxW) as string[];
        const lh = pr.lineH ?? pr.size * 1.15;
        if (pr.maxLines && lines.length > pr.maxLines) {
          lines = lines.slice(0, pr.maxLines);
          lines[lines.length - 1] = lines[lines.length - 1].replace(/[\s\S]{1}$/, '') + '…'; // ellipsis on truncation
        }
        lines.forEach((ln, i) => doc.text(ln, anchorX, baseline + i * lh, { align: pr.align } as any));
      } else {
        doc.text(pr.text, anchorX, baseline, { align: pr.align } as any);
      }
    }
  });
  doc.setTextColor(0, 0, 0);
}

/** Build a PDF laying labels out per the chosen paper size + per-page grid. */
export function buildLabelsPdf(orders: LabelOrder[], products: Product[], fmt: LabelFormat): Blob {
  const byId = new Map(products.map((p) => [p.productId, p]));
  const g = labelGeometry(fmt);
  const perPage = g.cols * g.rows;
  const orient: 'landscape' | 'portrait' = g.pw > g.ph ? 'landscape' : 'portrait';

  const doc = new jsPDF({ unit: 'pt', format: [g.pw, g.ph], orientation: orient });

  orders.forEach((o, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage([g.pw, g.ph], orient);
    const idx = i % perPage;
    const col = idx % g.cols;
    const row = Math.floor(idx / g.cols);
    const [ox, oy] = labelCellOrigin(g, col, row);
    const prims = computeLabelLayout(g.cellW, g.cellH, buildLabelFields(o, byId));
    renderPrimitives(doc, prims, ox, oy);
  });

  return doc.output('blob');
}

export function downloadLabels(orders: LabelOrder[], products: Product[], fmt: LabelFormat, filename?: string) {
  const blob = buildLabelsPdf(orders, products, fmt);
  triggerDownload(blob, filename || `labels_${istDayKey(new Date())}.pdf`);
}

/**
 * Open the labels PDF in a new tab / system viewer so the user can Print or
 * Share-to-printer. Must be called from a click handler (popup = user gesture).
 */
export function printLabels(orders: LabelOrder[], products: Product[], fmt: LabelFormat) {
  const blob = buildLabelsPdf(orders, products, fmt);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000); // give the viewer time to load
}
