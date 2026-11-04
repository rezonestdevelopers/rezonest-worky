import { Decimal, toDecimal, type DecimalLike } from "@/lib/money/decimal";

export const ASSET_KINDS = ["DOMAIN", "HOSTING", "SSL", "BUSINESS_EMAIL"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const KIND_LABEL: Record<string, string> = { DOMAIN: "Domain", HOSTING: "Hosting", SSL: "SSL", BUSINESS_EMAIL: "Business email" };
export const assetKindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** Red from 7 days out or once expired, amber up to 30 days, green after that. */
export function renewalUrgency(daysLeft: number): { tone: "red" | "amber" | "green"; label: string } {
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (daysLeft < 0) return { tone: "red", label: `Expired ${plural(-daysLeft)} ago` };
  if (daysLeft === 0) return { tone: "red", label: "Expires today" };
  const label = `${plural(daysLeft)} left`;
  if (daysLeft <= 7) return { tone: "red", label };
  return { tone: daysLeft <= 30 ? "amber" : "green", label };
}

/** What you keep from a renewal, and that as a share of the selling price. */
export function renewalMargin(cost: DecimalLike, price: DecimalLike): { amount: Decimal; percent: number | null } {
  const c = toDecimal(cost);
  const p = toDecimal(price);
  const amount = p.minus(c);
  return { amount, percent: p.greaterThan(0) ? amount.times(100).dividedBy(p).toDecimalPlaces(1).toNumber() : null };
}

/** The same date a year on. 29 Feb moves to 28 Feb in a year without one. */
export function oneYearAfter(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** Client passwords must never be stored here. This catches the obvious slip, "password: abc123". */
export function looksLikePassword(text: string | null | undefined): boolean {
  return /\b(pass\s*word|passwd|pwd|login\s*pin)\s*(is\b|[:=])\s*\S/i.test(text ?? "");
}
