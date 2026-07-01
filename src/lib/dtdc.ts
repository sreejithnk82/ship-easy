// Build the DTDC bulk-booking .xlsx from scanned orders.
//
// The 40-column layout (A–AN) and field ownership are fixed by the DTDC
// template. Sender block comes from the customer, product columns from the
// product, receiver columns from the order, state from the pincode. weight,
// dims and declared value are emitted as NUMBERS; everything else as text.

import * as XLSX from 'xlsx';
import type { Product } from './api';
import { stateFromPincode } from './pincode';
import { istDayKey } from './datetime';

// Exact header text + order from the DTDC sample. Do not reword.
export const DTDC_HEADERS: string[] = [
  'Consignment(CN) No.', 'Customer Reference Number', 'Number of pieces', 'Description',
  'Service Type', 'Shipment Type', 'Content', "If 'Others' please specify",
  'Declared Value', 'Risk Surcharge', 'weight(kg)', 'length(cm)', 'width(cm)', 'height(cm)',
  "Sender's Pincode", "Sender's Name", "Sender's Phone number", "Sender's Address Line 1",
  "Sender's Address Line 2", "Sender's City", "Sender's State", "Sender's Email",
  "Receiver's Pincode", "Receiver's Name", "Receiver's Phone Number", "Receiver's Address Line 1",
  "Receiver's Address Line 2", "Receiver's City", "Receiver's State", "Receiver's Email",
  'Hub Customer Code', 'VAS Product', 'VAS Mode of Collection', 'VAS in favor of', 'VAS Amount',
  'Consignment Type', 'Origin W3W Code', 'Destination W3W Code', 'Eway Bill', 'HSN Code',
];

const CONST = {
  pieces: 1,
  serviceType: 'EXPRESS',
  shipmentType: 'NON-DOCUMENT',
  riskSurcharge: 'NO_RISK',
};

export interface DtdcOrder {
  trackingId: string;
  productId: string;
  extraProductIds?: string[]; // additional products in the same parcel
  variant?: string;           // chosen sub-type label for the primary product
  extraVariants?: string[];   // labels index-aligned with extraProductIds
  receiverName: string;
  receiverPhone: string;
  receiverPincode: string;
  receiverLine1: string;
  receiverLine2: string;
  receiverState?: string;
}

/**
 * One DTDC row (array in DTDC_HEADERS order). A parcel can carry several products
 * (one label): weight + declared value are SUMMED across them, the package
 * dimensions are the LARGEST product's box (by volume), and the description lists
 * all items. Sender / hub / content come from the primary (first) product.
 */
export function buildDtdcRow(order: DtdcOrder, byId: Map<string, Product>): (string | number)[] {
  // Pair each product id with its chosen variant label, keeping index alignment
  // (primary first), then resolve products and drop any that no longer exist.
  const rawIds = [order.productId, ...(order.extraProductIds || [])];
  const rawVars = [order.variant || '', ...(order.extraVariants || [])];
  const entries = rawIds
    .map((id, i) => ({ id, v: rawVars[i] || '' }))
    .filter((e) => e.id)
    .map((e) => ({ p: byId.get(e.id), v: e.v }))
    .filter((e) => e.p) as { p: Product; v: string }[];
  const items = entries.map((e) => e.p);
  const p = items[0]; // primary → sender, hub, content

  // Sum weight + value across all items.
  const weightKg = items.reduce((s, it) => s + (Number(it.weightG) || 0), 0) / 1000;
  const declared = items.reduce((s, it) => s + (Number(it.declaredValue) || 0), 0);
  // Dimensions = the single largest box (by volume).
  const vol = (it: Product) => (Number(it.lengthCm) || 0) * (Number(it.widthCm) || 0) * (Number(it.heightCm) || 0);
  const biggest = items.reduce((a, b) => (vol(b) > vol(a) ? b : a), items[0]);
  // Description lists every item, with its variant label appended when present.
  const desc = entries.map((e) => {
    const base = e.p.description || e.p.name || '';
    return e.v ? `${base} - ${e.v}` : base;
  }).filter(Boolean).join(' + ') || (p?.name || '');
  const content = p?.content || 'OTHERS';
  const state = (order.receiverState && order.receiverState.trim())
    || stateFromPincode(order.receiverPincode);

  return [
    order.trackingId,                               // A  Consignment(CN) No.
    '',                                             // B  Customer Reference Number
    CONST.pieces,                                   // C  Number of pieces
    desc,                                           // D  Description
    CONST.serviceType,                              // E  Service Type
    CONST.shipmentType,                             // F  Shipment Type
    content,                                        // G  Content
    content === 'OTHERS' ? desc : '',               // H  If 'Others' please specify
    declared,                                       // I  Declared Value
    CONST.riskSurcharge,                            // J  Risk Surcharge
    weightKg,                                       // K  weight(kg)
    Number(biggest?.lengthCm) || 0,                 // L  length(cm)
    Number(biggest?.widthCm) || 0,                  // M  width(cm)
    Number(biggest?.heightCm) || 0,                 // N  height(cm)
    p?.senderPincode || '',                         // O  Sender's Pincode
    p?.senderName || '',                            // P  Sender's Name
    p?.senderPhone || '',                           // Q  Sender's Phone number
    p?.senderAddr1 || '',                           // R  Sender's Address Line 1
    p?.senderAddr2 || '',                           // S  Sender's Address Line 2
    p?.senderCity || '',                            // T  Sender's City
    p?.senderState || '',                           // U  Sender's State
    p?.senderEmail || '',                           // V  Sender's Email
    order.receiverPincode,                          // W  Receiver's Pincode
    order.receiverName,                             // X  Receiver's Name
    order.receiverPhone,                            // Y  Receiver's Phone Number
    `FOR DELIVERY, ${order.receiverLine1}`,         // Z  Receiver's Address Line 1
    order.receiverLine2,                            // AA Receiver's Address Line 2
    '',                                             // AB Receiver's City
    state,                                          // AC Receiver's State
    '',                                             // AD Receiver's Email
    p?.hubCustomerCode || '',                       // AE Hub Customer Code
    '', '', '', '',                                 // AF–AI VAS Product/Mode/Favor/Amount
    '',                                             // AJ Consignment Type
    '', '',                                         // AK–AL Origin/Destination W3W
    '',                                             // AM Eway Bill
    '',                                             // AN HSN Code
  ];
}

/** Build the workbook (header row + one row per order) as an .xlsx Blob. */
export function buildDtdcWorkbook(orders: DtdcOrder[], products: Product[]): Blob {
  const byId = new Map(products.map((p) => [p.productId, p]));
  const aoa: (string | number)[][] = [DTDC_HEADERS];
  orders.forEach((o) => aoa.push(buildDtdcRow(o, byId)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Trigger a browser download of the DTDC workbook. */
export function downloadDtdc(orders: DtdcOrder[], products: Product[], filename?: string) {
  const blob = buildDtdcWorkbook(orders, products);
  const name = filename || `ScannedItems_${istDayKey(new Date()).replace(/-/g, '')}.xlsx`;
  triggerDownload(blob, name);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
