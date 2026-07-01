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

const STATES = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan',
  'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
  'delhi', 'jammu and kashmir', 'ladakh', 'puducherry', 'chandigarh',
  'andaman and nicobar islands', 'dadra and nagar haveli', 'daman and diu', 'lakshadweep',
]);

// Known label spellings → canonical field key. Includes common abbreviations and
// concatenated multi-word forms ("contactnumber") so the fuzzy match below stays
// a small edit-distance away from real-world typos.
const LABELS: [string, string][] = [
  ['name', 'name'], ['nam', 'name'], ['naam', 'name'], ['customername', 'name'], ['custname', 'name'],
  ['address', 'address'], ['addres', 'address'], ['addr', 'address'], ['add', 'address'],
  ['location', 'address'], ['place', 'address'], ['house', 'address'], ['building', 'address'], ['landmark', 'address'], ['area', 'address'],
  ['district', 'district'], ['dist', 'district'], ['town', 'district'], ['city', 'district'], ['taluk', 'district'],
  ['state', 'state'],
  ['pincode', 'pin'], ['pin', 'pin'], ['pinno', 'pin'], ['postcode', 'pin'], ['postalcode', 'pin'], ['zip', 'pin'], ['zipcode', 'pin'],
  ['phone', 'phone'], ['phoneno', 'phone'], ['phonenumber', 'phone'], ['phno', 'phone'],
  ['mobile', 'phone'], ['mobileno', 'phone'], ['mobilenumber', 'phone'], ['mob', 'phone'], ['mobno', 'phone'],
  ['contact', 'phone'], ['contactno', 'phone'], ['contactnumber', 'phone'], ['whatsapp', 'phone'], ['number', 'phone'], ['cell', 'phone'], ['ph', 'phone'],
];

/** Levenshtein edit distance (small strings only). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Fuzzy-map a normalized label token to a field key, tolerating spelling slips. */
function fuzzyLabelKey(norm: string): string {
  let best = '', bestD = Infinity;
  for (const [word, key] of LABELS) {
    const d = lev(norm, word);
    if (d < bestD) { bestD = d; best = key; }
  }
  // Short tokens must match (almost) exactly; longer ones tolerate more slips.
  const thr = norm.length <= 2 ? 0 : norm.length <= 4 ? 1 : 2;
  return bestD <= thr ? best : '';
}

/**
 * If a line is "label: value" / "label - value" with a (possibly misspelled)
 * known label, return {key, value}; otherwise null. The label must be a short
 * alphabetic token before the first ':' (or '-'), so address lines that merely
 * contain a dash aren't mistaken for labels.
 */
function matchLabel(line: string): { key: string; value: string } | null {
  let idx = line.indexOf(':');
  if (idx < 0) idx = line.indexOf('-');
  if (idx <= 0) return null;
  const candidate = line.slice(0, idx).trim();
  if (!candidate || candidate.length > 20 || !/^[A-Za-z][A-Za-z .]*$/.test(candidate)) return null;
  const norm = candidate.toLowerCase().replace(/[^a-z]/g, '');
  if (!norm) return null;
  const key = fuzzyLabelKey(norm);
  return key ? { key, value: line.slice(idx + 1).trim() } : null;
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
    const ml = matchLabel(line);
    return { i, label: ml ? ml.key : '', value: ml ? ml.value : line };
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
 * Per-line bucketer for the drag-and-drop sorter. Same heuristics as
 * parseRawAddress, but keeps ONE entry per line (so each becomes a draggable
 * chip) and pre-places Name + Address too — not just phone/pincode. Anything it
 * can't confidently place (product/marketing lines after the contact block,
 * extra phone numbers) goes to `pool` for the operator to drag in.
 * ------------------------------------------------------------------------- */

export interface ClassifiedLines {
  name: string[]; phone: string[]; pincode: string[];
  line1: string[]; line2: string[]; pool: string[];
}

export function classifyLines(text: string): ClassifiedLines {
  const out: ClassifiedLines = { name: [], phone: [], pincode: [], line1: [], line2: [], pool: [] };
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^[-=_*~.\s]+$/.test(l));

  type Cl = { i: number; label: string; value: string; phone?: string; pin?: string };
  const cls: Cl[] = lines.map((line, i) => {
    const ml = matchLabel(line);
    return { i, label: ml ? ml.key : '', value: ml ? ml.value : line };
  });

  // Pass 1: phone + pincode (a line can carry both) and the contact-block end.
  let lastContactIdx = -1;
  let havePhone = false, havePin = false;
  for (const c of cls) {
    const ph = findMobile(c.value);
    if (ph) { c.phone = ph; lastContactIdx = Math.max(lastContactIdx, c.i); if (!havePhone) { out.phone.push(ph); havePhone = true; } else out.pool.push(ph); }
    const pin = findPincode(c.value);
    if (pin) { c.pin = pin; lastContactIdx = Math.max(lastContactIdx, c.i); if (!havePin) { out.pincode.push(pin); havePin = true; } else out.pool.push(pin); }
  }

  // Pass 2: name / address / district up to the contact block; rest → pool.
  const limit = lastContactIdx >= 0 ? lastContactIdx : cls.length - 1;
  const addr: string[] = [];
  const dist: string[] = [];
  let haveName = false;
  for (const c of cls) {
    if (c.i > limit) { out.pool.push(c.value); continue; }   // product/footer lines
    if (c.phone || c.pin) continue;                          // already used as contact
    if (c.label === 'phone' || c.label === 'pin') continue;  // label, no usable number
    if (c.label === 'state') continue;                       // state derived from pincode
    if (c.label === 'name') { if (!haveName) { out.name.push(clean(c.value)); haveName = true; } else out.pool.push(c.value); continue; }
    if (c.label === 'district') { dist.push(c.value); continue; }
    if (c.label === 'address') { addr.push(c.value); continue; }
    if (isStateName(c.value)) continue;                      // bare state name → drop
    if (!haveName) {
      // First freeform line is the name; split off any address after a comma.
      const ci = c.value.indexOf(',');
      if (ci > 0) { out.name.push(clean(c.value.slice(0, ci))); const rest = c.value.slice(ci + 1).trim(); if (rest) addr.push(rest); }
      else out.name.push(clean(c.value));
      haveName = true;
      continue;
    }
    addr.push(c.value);
  }

  const a = addr.map((p) => clean(p)).filter(Boolean);
  const d = dist.map((p) => clean(p)).filter(Boolean);
  if (d.length) { out.line1.push(...a); out.line2.push(...d); }
  else if (a.length >= 2) { out.line2.push(a[a.length - 1]); out.line1.push(...a.slice(0, -1)); }
  else { out.line1.push(...a); }

  return out;
}
