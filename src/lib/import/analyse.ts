import { findDuplicates, type Contactable, type DuplicateMatch } from "@/lib/contact-match";
import { findState } from "@/lib/india-states";
import { clientCreateSchema, type ClientCreateData } from "@/lib/validators/client";
import { isValidDateKey } from "@/lib/validators/common";
import { leadSchema, type LeadData } from "@/lib/validators/lead";

export type ImportKind = "leads" | "clients";
export type RawRow = { rowNumber: number; values: Record<string, string> };

export interface ImportField {
  key: string;
  label: string;
  aliases: string[];
  example: string;
}

export const LEAD_FIELDS: ImportField[] = [
  { key: "contactName", label: "Contact Person", aliases: ["contact", "name", "contact name", "person"], example: "Rahul Kale" },
  { key: "companyName", label: "Company", aliases: ["company name", "organisation", "organization", "business"], example: "BrightPath Academy" },
  { key: "phone", label: "Phone", aliases: ["mobile", "phone number", "contact number", "mobile number"], example: "+91 90496 22713" },
  { key: "whatsapp", label: "WhatsApp", aliases: ["whatsapp number"], example: "+91 90496 22713" },
  { key: "email", label: "Email", aliases: ["email id", "email address", "e-mail", "mail"], example: "rahul@example.com" },
  { key: "sector", label: "Sector", aliases: ["industry"], example: "Education & Coaching" },
  { key: "city", label: "City", aliases: ["location"], example: "Nigdi" },
  { key: "source", label: "Lead Source", aliases: ["source"], example: "Facebook" },
  { key: "services", label: "Services", aliases: ["services interested", "service", "interested in"], example: "Meta Ads, SEO Services" },
  { key: "budget", label: "Budget", aliases: ["approx budget", "approximate budget", "approx. budget"], example: "25000" },
  { key: "notes", label: "Notes", aliases: ["requirement", "requirements", "requirement notes", "remarks"], example: "Admission season campaign" },
  { key: "followUp", label: "Next Follow-up", aliases: ["follow up", "follow-up", "follow up date", "follow-up date", "next follow up"], example: "15/11/2026" },
];

export const CLIENT_FIELDS: ImportField[] = [
  { key: "companyName", label: "Company", aliases: ["company name", "client", "client name", "organisation", "organization", "business"], example: "Kalyani Auto Components Pvt Ltd" },
  { key: "contactName", label: "Contact Person", aliases: ["contact", "contact name", "person", "name"], example: "Sanjay Kalyani" },
  { key: "contactDesignation", label: "Designation", aliases: ["title", "role"], example: "Director" },
  { key: "phone", label: "Phone", aliases: ["mobile", "phone number", "contact number", "mobile number"], example: "+91 98230 11452" },
  { key: "whatsapp", label: "WhatsApp", aliases: ["whatsapp number"], example: "+91 98230 11452" },
  { key: "email", label: "Email", aliases: ["email id", "email address", "e-mail", "mail"], example: "sanjay@example.com" },
  { key: "website", label: "Website", aliases: ["url", "web"], example: "example.com" },
  { key: "sector", label: "Sector", aliases: ["industry"], example: "Automobile & Auto Components" },
  { key: "city", label: "City", aliases: ["location"], example: "Chakan" },
  { key: "state", label: "State", aliases: ["state name"], example: "Maharashtra" },
  { key: "country", label: "Country", aliases: [], example: "India" },
  { key: "billingAddress", label: "Billing Address", aliases: ["address"], example: "Plot 12, MIDC Chakan" },
  { key: "pincode", label: "PIN Code", aliases: ["pin", "pincode", "postal code"], example: "410501" },
  { key: "gstin", label: "GSTIN", aliases: ["gst", "gst no", "gst number"], example: "27AAECK4521M1Z8" },
  { key: "pan", label: "PAN", aliases: ["pan no", "pan number"], example: "AAECK4521M" },
  { key: "source", label: "Lead Source", aliases: ["source"], example: "LinkedIn" },
  { key: "tags", label: "Tags", aliases: [], example: "retainer, B2B" },
  { key: "notes", label: "Notes", aliases: ["remarks"], example: "" },
];

export const fieldsFor = (kind: ImportKind) => (kind === "leads" ? LEAD_FIELDS : CLIENT_FIELDS);

const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Works out which spreadsheet column is which field, by header name. The first matching column wins. */
export function mapHeaders(headers: string[], fields: ImportField[]): { mapping: Record<number, string>; ignored: string[] } {
  const mapping: Record<number, string> = {};
  const used = new Set<string>();
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;
    const field = fields.find(
      (f) => !used.has(f.key) && (normHeader(f.label) === n || f.key.toLowerCase() === n || f.aliases.includes(n)),
    );
    if (field) {
      mapping[i] = field.key;
      used.add(field.key);
    } else ignored.push(h.trim());
  });
  return { mapping, ignored };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Reads a date the Indian way: DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY or YYYY-MM-DD.
 * 03/04/2026 is 3 April, never 4 March. Returns null if it isn't a real date.
 */
export function parseImportDate(value: string): string | null {
  const v = value.trim();
  const pad = (n: string) => n.padStart(2, "0");
  let key: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) key = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) key = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  else if ((m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/))) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) key = `${m[3]}-${pad(String(month + 1))}-${pad(m[1])}`;
  }
  return key && isValidDateKey(key) ? key : null;
}

export interface ImportRefs {
  sectors: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
}

const byName = (list: { id: string; name: string }[], name: string) =>
  list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());

export interface AnalysedRow<T> {
  rowNumber: number;
  values: Record<string, string>;
  data: T | null;
  errors: string[];
  warnings: string[];
  duplicates: DuplicateMatch[];
}

type RowResult<T> = Omit<AnalysedRow<T>, "duplicates">;

export function analyseLeadRow(row: RawRow, refs: ImportRefs): RowResult<LeadData> {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];

  const sector = v.sector ? byName(refs.sectors, v.sector) : undefined;
  if (v.sector && !sector) warnings.push(`Sector “${v.sector}” isn't in your list, so it will be left blank`);
  const source = v.source ? byName(refs.sources, v.source) : undefined;
  if (v.source && !source) warnings.push(`Lead source “${v.source}” isn't in your list, so it will be left blank`);

  const serviceIds: string[] = [];
  for (const name of (v.services ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const service = byName(refs.services, name);
    if (service) serviceIds.push(service.id);
    else warnings.push(`Service “${name}” isn't in your catalogue, so it will be skipped`);
  }

  let followUp = "";
  if (v.followUp) {
    const parsedDate = parseImportDate(v.followUp);
    if (parsedDate) followUp = parsedDate;
    else errors.push(`“${v.followUp}” isn't a valid date. Use DD/MM/YYYY`);
  }

  const parsed = leadSchema.safeParse({
    contactName: v.contactName ?? "",
    companyName: v.companyName,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email,
    sectorId: sector?.id ?? "",
    city: v.city,
    leadSourceId: source?.id ?? "",
    servicesInterested: serviceIds,
    approxBudget: v.budget,
    requirementNotes: v.notes,
    nextFollowUpDate: followUp,
    ownerId: "",
  });
  if (!parsed.success) errors.push(...parsed.error.issues.map((i) => i.message));
  return { rowNumber: row.rowNumber, values: v, data: parsed.success && !errors.length ? parsed.data : null, errors, warnings };
}

export function analyseClientRow(row: RawRow, refs: ImportRefs): RowResult<ClientCreateData> {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];

  const sector = v.sector ? byName(refs.sectors, v.sector) : undefined;
  if (v.sector && !sector) warnings.push(`Sector “${v.sector}” isn't in your list, so it will be left blank`);
  const source = v.source ? byName(refs.sources, v.source) : undefined;
  if (v.source && !source) warnings.push(`Lead source “${v.source}” isn't in your list, so it will be left blank`);

  const country = v.country?.trim() || "India";
  const gstin = v.gstin?.trim().toUpperCase() ?? "";
  let stateCode = "";
  let badState = false;
  if (country.toLowerCase() === "india") {
    if (v.state?.trim()) {
      const state = findState(v.state);
      if (state) stateCode = state.code;
      else {
        badState = true;
        errors.push(`“${v.state}” isn't a recognised Indian state`);
      }
    } else if (/^\d{2}/.test(gstin)) {
      stateCode = gstin.slice(0, 2);
    } else {
      // The state decides CGST+SGST vs IGST, so this assumption is shown in the preview.
      stateCode = "27";
      warnings.push("No state given, so Maharashtra is assumed. This decides GST on invoices");
    }
  }

  const parsed = clientCreateSchema.safeParse({
    companyName: v.companyName ?? "",
    contactName: v.contactName || v.companyName || "",
    contactDesignation: v.contactDesignation,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email,
    website: v.website,
    sectorId: sector?.id ?? "",
    city: v.city,
    country,
    stateCode,
    billingAddress: v.billingAddress,
    pincode: v.pincode,
    gstin,
    pan: v.pan,
    leadSourceId: source?.id ?? "",
    accountManagerId: "",
    tags: v.tags,
    notes: v.notes,
    status: "ACTIVE",
  });
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message);
    errors.push(...(badState ? messages.filter((m) => m !== "Select the client's state") : messages));
  }
  return { rowNumber: row.rowNumber, values: v, data: parsed.success && !errors.length ? parsed.data : null, errors, warnings };
}

/**
 * Validates every row and finds duplicates, against existing records and against
 * earlier rows in the same file. Preview and final import both use this, so what
 * you approve is exactly what gets imported.
 */
export function analyseRows<T>(rows: RawRow[], analyse: (row: RawRow) => RowResult<T>, existing: Contactable[]): AnalysedRow<T>[] {
  const known = [...existing];
  return rows.map((row) => {
    const result = analyse(row);
    const contact = { phones: [row.values.phone, row.values.whatsapp], emails: [row.values.email], gstin: row.values.gstin };
    const duplicates = findDuplicates(contact, known);
    // A row that can't be imported can't be the original of a later row.
    if (result.data) known.push({ id: `row-${row.rowNumber}`, name: `row ${row.rowNumber} of this file`, kind: "lead", ...contact });
    return { ...result, duplicates };
  });
}
