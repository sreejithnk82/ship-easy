// Build a WhatsApp "click to chat" link for a shipped order, pre-filled with the
// tracking message. The operator still taps Send in WhatsApp — nothing is sent
// automatically. Returns null if the phone number can't be normalised.

/** Normalise an Indian mobile number to wa.me digits (country code, no +). */
export function normalizePhone(phone: string): string | null {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;                       // bare 10-digit
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1); // leading 0
  if (d.length === 12 && d.startsWith('91')) return d;        // already 91xxxxxxxxxx
  if (d.length >= 11 && d.length <= 15) return d;             // assume includes a country code
  return null;                                                // too short / unusable
}

export function shipmentMessage(trackingId: string): string {
  return `Your order is Shipped with track ID ${trackingId} (DTDC). You can track this at https://www.dtdc.com/track-your-shipment/`;
}

/** wa.me link, or null if the phone is unusable. */
export function whatsappShareLink(phone: string, trackingId: string): string | null {
  const n = normalizePhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(shipmentMessage(trackingId))}`;
}
