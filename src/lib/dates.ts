import type { ISODate } from './types';

// All dates are local calendar dates as 'YYYY-MM-DD'. The firm runs on IST only.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n: number) => String(n).padStart(2, '0');

export function iso(y: number, m: number, d: number): ISODate {
  // m is 1-based; normalise overflow through Date
  const dt = new Date(y, m - 1, d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function toDate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fromDate(d: Date): ISODate {
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function today(): ISODate {
  return fromDate(new Date());
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = toDate(s);
  return iso(d.getFullYear(), d.getMonth() + 1 + n, 1);
}

export function diffDays(a: ISODate, b: ISODate): number {
  // a - b in whole days
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Clamp a day to the month length (e.g. 31 in a 30-day month). */
export function safeIso(y: number, m: number, d: number): ISODate {
  return iso(y, m, Math.min(d, lastDayOfMonth(y, m)));
}

export function weekday(s: ISODate): number {
  return toDate(s).getDay();
}

/** Monday of the week containing s. */
export function weekStart(s: ISODate): ISODate {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

export function weekDates(start: ISODate, days = 7): ISODate[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function fmtDate(s?: ISODate): string {
  if (!s) return '—';
  const d = toDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtShort(s: ISODate): string {
  const d = toDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDay(s: ISODate): string {
  const d = toDate(s);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function dayName(s: ISODate, long = false): string {
  return (long ? DAYS_LONG : DAYS)[toDate(s).getDay()];
}

export function monthLabel(y: number, m: number): string {
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

export function fmtDateTime(s: string): string {
  const d = new Date(s);
  const hh = d.getHours();
  const h12 = hh % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h12}:${pad(d.getMinutes())} ${hh < 12 ? 'AM' : 'PM'}`;
}

export function relDue(due: ISODate, ref: ISODate = today()): string {
  const n = diffDays(due, ref);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n > 1) return `Due in ${n} days`;
  if (n === -1) return 'Overdue by 1 day';
  return `Overdue by ${-n} days`;
}

// ---- Indian financial year helpers (fn_financial_year / fn_fiscal_quarter) ----

export function fyStartYear(s: ISODate): number {
  const d = toDate(s);
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${pad((startYear + 1) % 100)}`;
}

export function ayLabel(fyStart: number): string {
  return `AY ${fyStart + 1}-${pad((fyStart + 2) % 100)}`;
}

export function fyKey(startYear: number): string {
  return `FY${startYear}-${pad((startYear + 1) % 100)}`;
}

/** Fiscal quarter 1..4 for a calendar month (Apr–Jun = Q1). */
export function fiscalQuarter(month: number): number {
  return month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4;
}

/** Calendar start (y, m) of FY quarter q for FY starting in startYear. */
export function quarterStart(startYear: number, q: number): { y: number; m: number } {
  const m0 = 4 + (q - 1) * 3; // 4,7,10,13
  return m0 > 12 ? { y: startYear + 1, m: m0 - 12 } : { y: startYear, m: m0 };
}

/** First occurrence of (month, day) on or after `from`. */
export function firstOnOrAfter(from: ISODate, month: number, day: number): ISODate {
  const f = toDate(from);
  let y = f.getFullYear();
  let candidate = safeIso(y, month, day);
  if (candidate < from) {
    y += 1;
    candidate = safeIso(y, month, day);
  }
  return candidate;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Hours as "6 h", "6.5 h", "45 min" */
export function fmtHours(h: number): string {
  if (h === 0) return '0 h';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (whole === 0) return `${mins} min`;
  if (mins === 0) return `${whole} h`;
  return `${whole} h ${mins} m`;
}

export function fmtHoursShort(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, '');
}
