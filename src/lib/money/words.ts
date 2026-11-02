import { Decimal, toDecimal, type DecimalLike } from "./decimal";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 → words, tens hyphenated ("Twenty-Five"). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

/** 0–999 → words. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/**
 * Integer → words in the Indian numbering system (Thousand, Lakh, Crore).
 * Amounts ≥ 100 crore recurse on the crore part ("One Hundred Crore").
 */
export function integerToIndianWords(value: number | bigint): string {
  let n = BigInt(value);
  if (n < 0n) throw new Error("Negative amounts are not supported");
  if (n === 0n) return "Zero";

  const parts: string[] = [];
  const crore = n / 10000000n;
  n %= 10000000n;
  const lakh = n / 100000n;
  n %= 100000n;
  const thousand = n / 1000n;
  n %= 1000n;
  const rest = Number(n);

  if (crore > 0n) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0n) parts.push(`${twoDigits(Number(lakh))} Lakh`);
  if (thousand > 0n) parts.push(`${twoDigits(Number(thousand))} Thousand`);
  if (rest > 0) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/**
 * ₹ amount → "Rupees One Lakh Twenty-Five Thousand Only"
 * With paise → "Rupees Ten and Fifty Paise Only"
 */
export function amountInWords(amount: DecimalLike): string {
  const d = toDecimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (d.isNegative()) throw new Error("Negative amounts are not supported");
  const rupees = BigInt(d.floor().toFixed(0));
  const paise = d.minus(d.floor()).times(100).toNumber();

  const rupeeWords = `Rupees ${integerToIndianWords(rupees)}`;
  if (paise > 0) return `${rupeeWords} and ${twoDigits(Math.round(paise))} Paise Only`;
  return `${rupeeWords} Only`;
}
