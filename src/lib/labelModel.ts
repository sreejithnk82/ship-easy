// One source of truth for what a printed label shows, so the on-screen preview
// tile and the PDF can never drift apart. Maps the order + product (+ booking
// time) onto the DTDC-style label fields, skipping anything we don't have data for.

import type { Product } from './api';
import { istDateLabel, istDateTimeLabel } from './datetime';

export interface LabelOrder {
  trackingId: string;
  productId: string;
  receiverName: string;
  receiverPhone: string;
  receiverPincode: string;
  receiverLine1: string;
  receiverLine2: string;
  receiverState?: string;
}

export interface LabelMeta {
  /** When the order was booked (for Ship Date / footer). Defaults to now (IST). */
  bookedAt?: number | string | Date;
}

export interface LabelFields {
  trackingId: string;
  prefix: string;          // big service letter box (range prefix, e.g. "R")
  fromName: string;
  fromLines: string[];
  toName: string;
  toLines: string[];
  shipDate: string;        // IST date
  shipValue: string;       // declared value (₹)
  pincode: string;         // big destination pincode
  phone: string;
  service: string;         // "EXPRESS"
  pcs: string;             // "001 OF 001"
  productDesc: string;
  org: string;             // origin hub code
  weight: string;          // "0.080 kg"
  bookedAt: string;        // IST date-time (footer)
}

export function buildLabelFields(o: LabelOrder, product: Product | undefined, meta: LabelMeta = {}): LabelFields {
  const p = product;
  const when = meta.bookedAt ?? new Date();
  const tid = String(o.trackingId || '');
  const prefix = (tid.match(/^\D+/)?.[0] || tid.charAt(0) || '').toUpperCase();

  const fromLines = [
    [p?.senderAddr1, p?.senderAddr2].filter(Boolean).join(', '),
    [p?.senderCity, p?.senderState].filter(Boolean).join(', '),
    p?.senderPincode ? `PIN: ${p.senderPincode}` : '',
  ].filter(Boolean) as string[];

  const toLines = [
    o.receiverLine1,
    o.receiverLine2,
    o.receiverState || '',
  ].filter(Boolean) as string[];

  const wKg = p ? (Number(p.weightG) || 0) / 1000 : 0;

  return {
    trackingId: tid,
    prefix,
    fromName: p?.senderName || '',
    fromLines,
    toName: o.receiverName || '',
    toLines,
    shipDate: istDateLabel(when),
    shipValue: p ? String(Number(p.declaredValue) || 0) : '',
    pincode: String(o.receiverPincode || ''),
    phone: String(o.receiverPhone || ''),
    service: 'EXPRESS',
    pcs: '001 OF 001',
    productDesc: p?.description || p?.content || p?.name || '',
    org: p?.hubCustomerCode || '',
    weight: `${wKg.toFixed(3)} kg`,
    bookedAt: istDateTimeLabel(when),
  };
}
