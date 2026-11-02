import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, format } from "date-fns";

/**
 * Date conventions
 * ─────────────────
 * - Timezone is always Asia/Kolkata.
 * - Calendar dates (@db.Date columns: due dates, expiry, publish date) are
 *   stored as UTC midnight of the IST calendar day, and handled in code as
 *   "date keys" — strings "YYYY-MM-DD". Comparing keys as strings is safe.
 * - Timestamps (createdAt, acceptedAt…) are real instants; shown in IST.
 */
export const TZ = "Asia/Kolkata";

/** IST calendar day of an instant → "YYYY-MM-DD". Defaults to now. */
export function istDateKey(instant: Date = new Date()): string {
  return format(new TZDate(instant.getTime(), TZ), "yyyy-MM-dd");
}

/** A @db.Date value (UTC midnight) → "YYYY-MM-DD". */
export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight, for writing @db.Date columns. */
export function keyToDate(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`Invalid date key: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}

export function todayKey(): string {
  return istDateKey();
}

export function addDaysKey(key: string, days: number): string {
  return dateOnlyKey(addDays(keyToDate(key), days));
}

/** Calendar days from a → b (positive if b is later). */
export function daysBetweenKeys(a: string, b: string): number {
  return differenceInCalendarDays(keyToDate(b), keyToDate(a));
}

/** "2026-11" */
export function monthKeyOf(key: string): string {
  return key.slice(0, 7);
}

/** First and last day keys of the month containing `key`. */
export function monthRange(key: string): { start: string; end: string } {
  const [y, m] = key.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

/** Shift a "YYYY-MM" month key by n months. */
export function shiftMonth(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Indian financial year (April–March) for a date key → "2026-27". */
export function financialYear(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-02" or a @db.Date → "02 Nov 2026" */
export function formatDateKey(key: string | Date | null | undefined): string {
  if (!key) return "—";
  const k = typeof key === "string" ? key : dateOnlyKey(key);
  const [y, m, d] = k.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Timestamp → "02 Nov 2026" in IST */
export function formatDate(instant: Date | null | undefined): string {
  if (!instant) return "—";
  return formatDateKey(istDateKey(instant));
}

/** Timestamp → "02 Nov 2026, 09:05 AM" in IST */
export function formatDateTime(instant: Date | null | undefined): string {
  if (!instant) return "—";
  return format(new TZDate(instant.getTime(), TZ), "dd MMM yyyy, hh:mm a");
}

/** "2026-11" → "Nov 2026" ; short: "Nov 26" */
export function formatMonthKey(monthKey: string, short = false): string {
  const [y, m] = monthKey.split("-");
  return short ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : `${MONTHS[Number(m) - 1]} ${y}`;
}
