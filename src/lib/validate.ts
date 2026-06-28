// Shared input validation for receiver/sender details, so Book Orders and the
// Scan-edit form enforce the same rules. Kept dependency-free and synchronous.

/** Strip to digits and drop a leading +91 / 91 / 0 country-or-trunk prefix → the 10-digit core. */
export function indianMobileCore(phone: string | number | null | undefined): string {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** True for a valid Indian mobile number (10 digits, starts 6-9), tolerating +91/0 prefixes. */
export function isValidIndianMobile(phone: string | number | null | undefined): boolean {
  return /^[6-9]\d{9}$/.test(indianMobileCore(phone));
}

/** Trimmed length is at least `n` (default 3). */
export function minChars(s: string | null | undefined, n = 3): boolean {
  return String(s ?? '').trim().length >= n;
}

/**
 * Validate a receiver/sender block the same way everywhere. Returns the first
 * problem as a user-facing string, or null when everything is fine. `pincodeOk`
 * is passed in so callers can reuse their existing pincode check.
 */
export function validateContact(v: { name: string; phone: string; line1: string; line2: string }): string | null {
  if (!minChars(v.name)) return 'Name must be at least 3 characters.';
  if (!isValidIndianMobile(v.phone)) return 'Enter a valid 10-digit Indian mobile number.';
  if (!minChars(v.line1)) return 'Address Line 1 must be at least 3 characters.';
  if (!minChars(v.line2)) return 'Address Line 2 must be at least 3 characters.';
  return null;
}
