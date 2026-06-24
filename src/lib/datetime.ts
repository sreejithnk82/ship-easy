// Everything user-facing is shown in India Standard Time (IST), regardless of
// the device's timezone. Backend timestamps are already written in IST (with a
// +05:30 offset); these helpers also correctly render any older UTC ("…Z") rows,
// since both parse to the same instant and we format in Asia/Kolkata.

const IST = 'Asia/Kolkata';
const toDate = (ts: number | string | Date): Date => (ts instanceof Date ? ts : new Date(ts));

/** "YYYY-MM-DD" in IST — matches <input type="date"> and is safe for grouping. */
export function istDayKey(ts: number | string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(toDate(ts));
}

/** "24 Jun 2026" in IST. */
export function istDateLabel(ts: number | string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(ts));
}

/** "04:05 PM" in IST. */
export function istTimeLabel(ts: number | string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true }).format(toDate(ts));
}

/** "24 Jun 2026, 04:05 PM" in IST. */
export function istDateTimeLabel(ts: number | string | Date): string {
  return `${istDateLabel(ts)}, ${istTimeLabel(ts)}`;
}

/** Today's date as "YYYY-MM-DD" in IST. */
export function todayIstDayKey(): string {
  return istDayKey(new Date());
}
