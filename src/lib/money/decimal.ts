import Decimal from "decimal.js";

/**
 * All money maths in the app goes through decimal.js — never JS floating point.
 * Prisma returns `Decimal` objects for @db.Decimal columns; `toDecimal` accepts
 * those, strings, numbers and null.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type DecimalLike = Decimal | string | number | { toString(): string } | null | undefined;

export function toDecimal(value: DecimalLike): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "number" ? value : value.toString());
}

/** Round to paise (2 dp), half-up — the rule used everywhere. */
export function round2(value: DecimalLike): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Convert to a plain JS number for charts/display ONLY — never for further maths. */
export function toNumber(value: DecimalLike): number {
  return toDecimal(value).toNumber();
}
