// Generate printable shipping labels as a PDF — one label per page — with a
// Code128 barcode of the tracking ID plus the receiver and sender blocks.
// Runs entirely in the browser (jsPDF + JsBarcode), so it works offline once
// the tracking IDs are in hand.

import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import type { Product } from './api';
import { triggerDownload } from './dtdc';
import { istDayKey } from './datetime';

export interface LabelOrder {
  trackingId: string;
  productId: string;
  receiverName: string;
  receiverPhone: string;
  receiverPincode: string;
  receiverLine1: string;
  receiverLine2: string;
}

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    displayValue: true,
    fontSize: 14,
    height: 50,
    margin: 0,
  });
  return canvas.toDataURL('image/png');
}

/** Build a multi-page PDF (one label per page) and return it as a Blob. */
export function buildLabelsPdf(orders: LabelOrder[], products: Product[]): Blob {
  const byId = new Map(products.map((p) => [p.productId, p]));
  // Compact 4x6 inch thermal-label size in points (1in = 72pt).
  const doc = new jsPDF({ unit: 'pt', format: [288, 432] });
  const W = 288;
  const M = 16;

  orders.forEach((o, idx) => {
    if (idx > 0) doc.addPage([288, 432], 'portrait');
    const product = byId.get(o.productId);
    let y = M + 6;

    doc.setLineWidth(1);
    doc.rect(M / 2, M / 2, W - M, 432 - M);

    // Barcode of the tracking ID.
    try {
      const img = barcodeDataUrl(o.trackingId);
      doc.addImage(img, 'PNG', M, y, W - 2 * M, 60);
    } catch {
      doc.setFontSize(14);
      doc.text(o.trackingId, M, y + 20);
    }
    y += 76;

    doc.setDrawColor(0);
    doc.line(M, y, W - M, y);
    y += 18;

    // Ship To.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('SHIP TO:', M, y);
    y += 18;
    doc.setFontSize(14);
    doc.text(o.receiverName.toUpperCase(), M, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y = wrapY(doc, o.receiverLine1, M, y, W - 2 * M, 13);
    y = wrapY(doc, o.receiverLine2, M, y, W - 2 * M, 13);

    doc.setFont('helvetica', 'bold');
    doc.text(`PIN: ${o.receiverPincode}`, M, y + 4); y += 18;
    doc.text(`PH: ${o.receiverPhone}`, M, y); y += 18;

    doc.line(M, y, W - M, y); y += 16;

    // Product + Sender.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (product) { doc.text(`Item: ${product.name}`, M, y); y += 16; }

    doc.setFontSize(9);
    doc.text('From:', M, y); y += 13;
    doc.setFont('helvetica', 'bold');
    doc.text(product?.senderName || '', M, y); y += 12;
    doc.setFont('helvetica', 'normal');
    y = wrapY(doc, `${product?.senderAddr1 || ''} ${product?.senderAddr2 || ''}`.trim(), M, y, W - 2 * M, 11);
    doc.text(`${product?.senderCity || ''} - ${product?.senderPincode || ''}`, M, y);
  });

  return doc.output('blob');
}

// Draw wrapped text and return the new y.
function wrapY(doc: jsPDF, text: string, x: number, y: number, maxW: number, lh: number): number {
  const lines = doc.splitTextToSize(text || '', maxW) as string[];
  lines.forEach((line) => { doc.text(line, x, y); y += lh; });
  return y;
}

export function downloadLabels(orders: LabelOrder[], products: Product[], filename?: string) {
  const blob = buildLabelsPdf(orders, products);
  triggerDownload(blob, filename || `labels_${istDayKey(new Date())}.pdf`);
}
