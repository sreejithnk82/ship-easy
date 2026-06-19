// Derive the Indian state from a 6-digit PIN code for the DTDC "Receiver's State"
// column. India Post PINs map to postal circles that mostly align with states.
// This uses the first TWO digits, which is accurate for the vast majority of
// pincodes; a few border prefixes are approximate, so the operator can always
// correct the value before export. Edit STATE_BY_PREFIX2 to refine.

const STATE_BY_PREFIX2: Record<string, string> = {
  '11': 'DELHI',
  '12': 'HARYANA', '13': 'HARYANA',
  '14': 'PUNJAB', '15': 'PUNJAB', '16': 'PUNJAB',
  '17': 'HIMACHAL PRADESH',
  '18': 'JAMMU AND KASHMIR', '19': 'JAMMU AND KASHMIR',
  '20': 'UTTAR PRADESH', '21': 'UTTAR PRADESH', '22': 'UTTAR PRADESH',
  '23': 'UTTAR PRADESH', '24': 'UTTAR PRADESH', '25': 'UTTAR PRADESH',
  '26': 'UTTAR PRADESH', '27': 'UTTAR PRADESH', '28': 'UTTAR PRADESH',
  '30': 'RAJASTHAN', '31': 'RAJASTHAN', '32': 'RAJASTHAN',
  '33': 'RAJASTHAN', '34': 'RAJASTHAN',
  '36': 'GUJARAT', '37': 'GUJARAT', '38': 'GUJARAT', '39': 'GUJARAT',
  '40': 'MAHARASHTRA', '41': 'MAHARASHTRA', '42': 'MAHARASHTRA',
  '43': 'MAHARASHTRA', '44': 'MAHARASHTRA',
  '45': 'MADHYA PRADESH', '46': 'MADHYA PRADESH',
  '47': 'MADHYA PRADESH', '48': 'MADHYA PRADESH',
  '49': 'CHHATTISGARH',
  '50': 'TELANGANA',
  '51': 'ANDHRA PRADESH', '52': 'ANDHRA PRADESH', '53': 'ANDHRA PRADESH',
  '56': 'KARNATAKA', '57': 'KARNATAKA', '58': 'KARNATAKA', '59': 'KARNATAKA',
  '60': 'TAMIL NADU', '61': 'TAMIL NADU', '62': 'TAMIL NADU',
  '63': 'TAMIL NADU', '64': 'TAMIL NADU',
  '67': 'KERALA', '68': 'KERALA', '69': 'KERALA',
  '70': 'WEST BENGAL', '71': 'WEST BENGAL', '72': 'WEST BENGAL',
  '73': 'WEST BENGAL', '74': 'WEST BENGAL',
  '75': 'ODISHA', '76': 'ODISHA', '77': 'ODISHA',
  '78': 'ASSAM', '79': 'NORTH EAST',
  '80': 'BIHAR', '81': 'BIHAR', '82': 'BIHAR', '84': 'BIHAR',
  '83': 'JHARKHAND', '85': 'JHARKHAND',
};

/** Returns the uppercase state name, or '' if the pincode is unknown/invalid. */
export function stateFromPincode(pin: string | number | null | undefined): string {
  const digits = String(pin ?? '').replace(/\D/g, '');
  if (digits.length !== 6) return '';
  return STATE_BY_PREFIX2[digits.slice(0, 2)] || '';
}

/** True for a syntactically valid 6-digit Indian PIN (first digit 1-8). */
export function isValidPincode(pin: string | number | null | undefined): boolean {
  const digits = String(pin ?? '').replace(/\D/g, '');
  return /^[1-8]\d{5}$/.test(digits);
}
