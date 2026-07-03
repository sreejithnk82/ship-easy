// One source of truth for what a printed label shows, so the on-screen preview
// tile and the PDF can never drift apart. Priorities (kept even on small labels):
// a scannable barcode + tracking id, ALL products (name + variant) in the order,
// receiver name, pincode and phone. Sender is trimmed to a name (dropped on tiny
// labels); receiver address is shown when there's room.

import type { Product } from './api';

export interface LabelOrder {
  trackingId: string;
  productId: string;
  variant?: string;
  extraProductIds?: string[];  // additional products in the same parcel
  extraVariants?: string[];    // labels, index-aligned with extraProductIds
  receiverName: string;
  receiverPhone: string;
  receiverPincode: string;
  receiverLine1: string;
  receiverLine2: string;
  receiverState?: string;
}

export interface LabelFields {
  trackingId: string;
  fromName: string;      // sender name only (return reference)
  toName: string;
  phone: string;
  addrLines: string[];   // receiver address (line1, line2)
  pincode: string;
  state: string;         // destination state (shown by the big pincode)
  products: string[];    // every product in the parcel, "Name - Variant"
}

export function buildLabelFields(o: LabelOrder, byId: Map<string, Product>): LabelFields {
  const primary = byId.get(o.productId);

  // Every product in the parcel with its chosen variant.
  const ids = [o.productId, ...(o.extraProductIds || [])];
  const variants = [o.variant || '', ...(o.extraVariants || [])];
  const products = ids
    .map((id, i) => {
      const nm = byId.get(id)?.name || byId.get(id)?.description || '';
      const v = variants[i];
      return (v ? `${nm} - ${v}` : nm).trim();
    })
    .filter(Boolean);
  if (!products.length) products.push(primary?.name || primary?.description || '');

  return {
    trackingId: String(o.trackingId || ''),
    fromName: primary?.senderName || '',
    toName: o.receiverName || '',
    phone: String(o.receiverPhone || ''),
    addrLines: [o.receiverLine1, o.receiverLine2].filter(Boolean) as string[],
    pincode: String(o.receiverPincode || ''),
    state: String(o.receiverState || '').trim(),
    products,
  };
}
