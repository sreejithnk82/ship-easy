// Best-effort parser for pasted order messages. Handles two common styles:
//   • Labeled:   "Name: …", "Address: …", "District: …", "State: …",
//                "Pincode: …", "Contact Number: …"
//   • Freeform:  name on the first line, a few address lines, then the pincode
//                and phone number(s).
// Trailing product lines (e.g. "crystal case", "ip 16pro") are dropped: anything
// after the last pincode/phone line is treated as non-address.

import { stateFromPincode } from './pincode';

export interface ParsedAddress {
  name: string;
  phone: string;
  pincode: string;
  state: string;
  line1: string;
  line2: string;
}

// "label: value" / "label - value" at the start of a line.
const LABEL_RE = /^\s*(name|address|addr|district|dist|state|pin\s*code|pincode|pin|contact\s*number|contact|phone|mobile|mob|whatsapp|ph)\s*[:\-]\s*(.*)$/i;

const STATES = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan',
  'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
  'delhi', 'jammu and kashmir', 'ladakh', 'puducherry', 'chandigarh',
  'andaman and nicobar islands', 'dadra and nagar haveli', 'daman and diu', 'lakshadweep',
]);

function labelKey(raw: string): string {
  const k = raw.toLowerCase().replace(/\s+/g, '');
  if (k.startsWith('name')) return 'name';
  if (k.startsWith('address') || k === 'addr') return 'address';
  if (k.startsWith('district') || k === 'dist') return 'district';
  if (k.startsWith('state')) return 'state';
  if (k.startsWith('pin')) return 'pin';
  if (k.startsWith('contact') || k.startsWith('phone') || k.startsWith('mobile') || k === 'mob' || k === 'ph' || k === 'whatsapp') return 'phone';
  return '';
}

/** First Indian mobile (10 digits, starts 6-9) in the string, tolerating +91/0 and spaces. */
function findMobile(s: string): string {
  const compact = s.replace(/[^\d+]/g, '');
  const m = compact.match(/(?:\+?91)?(?:0)?([6-9]\d{9})(?!\d)/);
  return m ? m[1] : '';
}

/** First standalone 6-digit pincode (first digit 1-9) in the string. */
function findPincode(s: string): string {
  const m = s.match(/(?:^|\D)([1-9]\d{5})(?:\D|$)/);
  return m ? m[1] : '';
}

function isStateName(s: string): boolean {
  return STATES.has(s.toLowerCase().replace(/[.,]/g, '').trim());
}

function clean(s: string): string {
  return s.replace(/[,;]+\s*$/, '').trim();
}

export function parseRawAddress(rawText: string): ParsedAddress {
  // Keep real content lines; drop blank and separator-only lines ("----", "===").
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l && !/^[-=_*~.\s]+$/.test(l));

  type Cl = { i: number; label: string; value: string; phone?: string; pin?: string };
  const cls: Cl[] = lines.map((line, i) => {
    const m = line.match(LABEL_RE);
    return { i, label: m ? labelKey(m[1]) : '', value: m ? m[2].trim() : line };
  });

  // Pass 1: pull out phone + pincode (a line can carry BOTH, e.g.
  // "…Pin 401107   +91 90822 77244") and remember how far the contact block goes.
  let phone = '';
  let pincode = '';
  let lastContactIdx = -1;
  for (const c of cls) {
    const ph = findMobile(c.value);
    if (ph) { c.phone = ph; if (!phone) phone = ph; lastContactIdx = Math.max(lastContactIdx, c.i); }
    const pin = findPincode(c.value);
    if (pin) { c.pin = pin; if (!pincode) pincode = pin; lastContactIdx = Math.max(lastContactIdx, c.i); }
  }

  // Pass 2: name / address / district / state from the lines up to the contact
  // block (everything after is product info).
  const limit = lastContactIdx >= 0 ? lastContactIdx : cls.length - 1;
  let name = '';
  let state = '';
  const addrParts: string[] = [];
  const distParts: string[] = [];

  for (const c of cls) {
    if (c.i > limit) break;
    if (c.phone || c.pin) continue;           // already consumed
    if (c.label === 'phone' || c.label === 'pin') continue; // label but unparseable → not address
    if (c.label === 'name') { if (!name) name = c.value; continue; }
    if (c.label === 'state') { if (!state) state = c.value; continue; }
    if (c.label === 'district') { distParts.push(c.value); continue; }
    if (c.label === 'address') { addrParts.push(c.value); continue; }
    // Unlabeled content line.
    if (isStateName(c.value)) { if (!state) state = c.value; continue; }
    if (!name) {
      // First freeform line is the name. If it also carries address text after a
      // comma ("Akshara Nair,Flat no 502, A Wing"), keep only the name here and
      // push the rest into the address.
      const ci = c.value.indexOf(',');
      if (ci > 0) {
        name = c.value.slice(0, ci).trim();
        const rest = c.value.slice(ci + 1).trim();
        if (rest) addrParts.push(rest);
      } else {
        name = c.value;
      }
      continue;
    }
    addrParts.push(c.value);
  }

  // Tidy each chunk (drop trailing commas) before joining so we don't get "a,, b".
  const tidy = (arr: string[]) => arr.map((p) => clean(p)).filter(Boolean);
  const addr = tidy(addrParts);
  const dist = tidy(distParts);

  let line1 = addr.join(', ');
  let line2 = dist.join(', ');
  // No explicit district but multiple address lines → use the last as line 2.
  if (!line2 && addr.length >= 2) {
    line2 = addr.pop() as string;
    line1 = addr.join(', ');
  }

  return {
    name: clean(name),
    phone,
    pincode,
    state: clean(state) || stateFromPincode(pincode),
    line1,
    line2,
  };
}

/* ------------------------------------------------------------------------- *
 * Single-line classifier — used by the drag-and-drop sorter to pre-place a
 * pasted line into a field zone and to strip any label prefix from the chip.
 * ------------------------------------------------------------------------- */

export type ChipZone = 'name' | 'phone' | 'pincode' | 'line1' | 'line2' | 'state' | '';

const LABEL_ZONE: Record<string, ChipZone> = {
  name: 'name', address: 'line1', district: 'line2', state: 'state', pin: 'pincode', phone: 'phone',
};

/**
 * Classify one pasted line for the sorter. Returns the chip `text` (label prefix
 * removed) and the `zone` it should pre-fill ('' = leave in the unassigned pool).
 * Labels win; otherwise an obvious phone/pincode is detected. For phone/pincode
 * the text is normalized to just the extracted number.
 */
export function classifyLine(line: string): { text: string; zone: ChipZone } {
  const m = line.match(LABEL_RE);
  if (m) {
    const zone = LABEL_ZONE[labelKey(m[1])] || '';
    const value = m[2].trim();
    if (zone === 'phone') return { text: findMobile(value) || value, zone };
    if (zone === 'pincode') return { text: findPincode(value) || value, zone };
    return { text: value, zone };
  }
  const ph = findMobile(line);
  if (ph) return { text: ph, zone: 'phone' };
  const pin = findPincode(line);
  if (pin) return { text: pin, zone: 'pincode' };
  return { text: line.trim(), zone: '' };
}
