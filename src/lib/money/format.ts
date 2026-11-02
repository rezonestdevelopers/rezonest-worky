import { toDecimal, type DecimalLike } from "./decimal";

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numIN = new Intl.NumberFormat("en-IN");

/** ₹1,25,000.00 */
export function formatINR(value: DecimalLike, opts: { decimals?: boolean } = {}): string {
  // Intl takes a number; we format a string-rounded value so no float maths happens.
  const d = toDecimal(value).toDecimalPlaces(2);
  const n = Number(d.toFixed(2));
  return (opts.decimals === false ? inrWhole : inrFull).format(n);
}

/** Short form for KPI cards: ₹950, ₹12.5K, ₹1.25L, ₹2.4Cr */
export function formatINRCompact(value: DecimalLike): string {
  const d = toDecimal(value);
  const neg = d.isNegative();
  const a = d.abs();
  let out: string;
  if (a.greaterThanOrEqualTo(10000000)) out = `₹${trim(a.dividedBy(10000000).toFixed(2))}Cr`;
  else if (a.greaterThanOrEqualTo(100000)) out = `₹${trim(a.dividedBy(100000).toFixed(2))}L`;
  else if (a.greaterThanOrEqualTo(1000)) out = `₹${trim(a.dividedBy(1000).toFixed(1))}K`;
  else out = `₹${trim(a.toFixed(0))}`;
  return neg ? `-${out}` : out;
}

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 1,25,000 */
export function formatNumberIN(value: number): string {
  return numIN.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
