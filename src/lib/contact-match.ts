/**
 * Duplicate detection for leads and clients. People type phone numbers in many
 * ways ("+91 98230 11452", "09823011452"), so numbers are compared on their
 * last 10 digits, emails ignoring case, and GSTIN exactly.
 */
export type MatchReason = "phone" | "email" | "GSTIN";

export interface Contactable {
  id: string;
  name: string;
  kind: "client" | "lead";
  phones: (string | null | undefined)[];
  emails: (string | null | undefined)[];
  gstin?: string | null;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  kind: "client" | "lead";
  reasons: MatchReason[];
}

/** Digits only, without the 0 / +91 prefix. Numbers under 7 digits are too short to compare. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits.replace(/^0+/, "");
}

export function normalizeEmail(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

export function findDuplicates(
  candidate: Pick<Contactable, "phones" | "emails" | "gstin">,
  existing: Contactable[],
): DuplicateMatch[] {
  const phones = new Set(candidate.phones.map(normalizePhone).filter(Boolean));
  const emails = new Set(candidate.emails.map(normalizeEmail).filter(Boolean));
  const gstin = candidate.gstin?.trim().toUpperCase() || null;

  const matches: DuplicateMatch[] = [];
  for (const e of existing) {
    const reasons: MatchReason[] = [];
    if (e.phones.some((p) => phones.has(normalizePhone(p)))) reasons.push("phone");
    if (e.emails.some((m) => emails.has(normalizeEmail(m)))) reasons.push("email");
    if (gstin && e.gstin?.trim().toUpperCase() === gstin) reasons.push("GSTIN");
    if (reasons.length) matches.push({ id: e.id, name: e.name, kind: e.kind, reasons });
  }
  return matches;
}
