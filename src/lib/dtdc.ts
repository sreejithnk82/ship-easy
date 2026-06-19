// Build the DTDC bulk-booking .xlsx from scanned orders.
//
// The 40-column layout (A–AN) and field ownership are fixed by the DTDC
// template. Sender block comes from the customer, product columns from the
// product, receiver columns from the order, state from the pincode. weight,
// dims and declared value are emitted as NUMBERS; everything else as text.

import * as XLSX from 'xlsx';
import type { Product } from './api';
import { stateFromPincode } from './pincode';

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
  receiverName: string;
  receiverPhone: string;
  receiverPincode: string;
  receiverLine1: string;
  receiverLine2: string;
  receiverState?: string;
}

/** One DTDC row (array in DTDC_HEADERS order). Sender/hub/content come from the product. */
export function buildDtdcRow(order: DtdcOrder, product: Product | undefined): (string | number)[] {
  const p = product;
  const desc = p?.description || p?.name || '';
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
    Number(p?.declaredValue) || 0,                  // I  Declared Value
    CONST.riskSurcharge,                            // J  Risk Surcharge
    (Number(p?.weightG) || 0) / 1000,               // K  weight(kg)
    Number(p?.lengthCm) || 0,                       // L  length(cm)
    Number(p?.widthCm) || 0,                        // M  width(cm)
    Number(p?.heightCm) || 0,                       // N  height(cm)
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
  orders.forEach((o) => aoa.push(buildDtdcRow(o, byId.get(o.productId))));

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
  const name = filename || `ScannedItems_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
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
