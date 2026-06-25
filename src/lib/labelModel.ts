// One source of truth for what a printed label shows, so the on-screen preview
// tile and the PDF can never drift apart. We only show what we actually have:
// DTDC mark, From, barcode + tracking ID, To, big pincode, product.

import type { Product } from './api';

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

export interface LabelFields {
  trackingId: string;
  fromName: string;
  fromLines: string[];
  toName: string;
  toLines: string[];
  pincode: string;
  productDesc: string;
}

export function buildLabelFields(o: LabelOrder, product: Product | undefined): LabelFields {
  const p = product;

  const fromLines = [
    [p?.senderAddr1, p?.senderAddr2].filter(Boolean).join(', '),
    [p?.senderCity, p?.senderState].filter(Boolean).join(', '),
    p?.senderPincode ? `PIN: ${p.senderPincode}` : '',
  ].filter(Boolean) as string[];

  const toLines = [
    o.receiverLine1,
    o.receiverLine2,
    [o.receiverState, o.receiverPincode].filter(Boolean).join(', '),
  ].filter(Boolean) as string[];

  return {
    trackingId: String(o.trackingId || ''),
    fromName: p?.senderName || '',
    fromLines,
    toName: o.receiverName || '',
    toLines,
    pincode: String(o.receiverPincode || ''),
    productDesc: p?.description || p?.content || p?.name || '',
  };
}
