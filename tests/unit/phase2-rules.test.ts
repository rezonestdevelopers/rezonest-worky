import { describe, expect, it } from "vitest";
import { findDuplicates, normalizePhone, type Contactable } from "@/lib/contact-match";
import { stageChangeError } from "@/lib/lead-stage";
import { safeExternalUrl } from "@/lib/safe-url";
import { parseCsv } from "@/lib/import/csv";
import { analyseClientRow, analyseLeadRow, analyseRows, CLIENT_FIELDS, LEAD_FIELDS, mapHeaders, parseImportDate, type ImportRefs } from "@/lib/import/analyse";
import { clientSchema } from "@/lib/validators/client";
import { leadSchema } from "@/lib/validators/lead";
import { moneyString, optionalMoney, optionalPhone } from "@/lib/validators/common";
import { serviceSchema, slugify, subServicesSchema, taskTemplateSchema } from "@/lib/validators/catalogue";
import { parseListParams } from "@/lib/list-params";

describe("phone matching", () => {
  it.each([
    ["+91 98230 11452", "9823011452"],
    ["09823011452", "9823011452"],
    ["919823011452", "9823011452"],
    ["98230-11452", "9823011452"],
    ["(020) 2712 3456", "2027123456"],
  ])("%s → %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it("ignores blanks and numbers too short to compare", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("duplicate detection", () => {
  const existing: Contactable[] = [
    { id: "c1", name: "Kalyani Auto", kind: "client", phones: ["+91 98230 11452"], emails: ["Sanjay@Kalyani.in"], gstin: "27AAECK4521M1Z8" },
    { id: "l1", name: "Moraya Builders", kind: "lead", phones: [null, "9011122233"], emails: [] },
  ];

  it("finds the same phone typed differently", () => {
    const m = findDuplicates({ phones: ["09823011452"], emails: [] }, existing);
    expect(m).toEqual([{ id: "c1", name: "Kalyani Auto", kind: "client", reasons: ["phone"] }]);
  });
  it("finds email ignoring case, and GSTIN", () => {
    const m = findDuplicates({ phones: [], emails: ["sanjay@kalyani.in"], gstin: "27aaeck4521m1z8" }, existing);
    expect(m[0].reasons).toEqual(["email", "GSTIN"]);
  });
  it("lists every reason that matched", () => {
    const m = findDuplicates({ phones: ["9823011452"], emails: ["sanjay@kalyani.in"], gstin: "27AAECK4521M1Z8" }, existing);
    expect(m[0].reasons).toEqual(["phone", "email", "GSTIN"]);
  });
  it("blank details never match blank details", () => {
    expect(findDuplicates({ phones: [null, ""], emails: [""], gstin: null }, [{ id: "x", name: "X", kind: "lead", phones: [null, ""], emails: [null] }])).toEqual([]);
  });
  it("no match means no warning", () => {
    expect(findDuplicates({ phones: ["9000000000"], emails: ["new@x.com"] }, existing)).toEqual([]);
  });
});

describe("lead stage rules", () => {
  const base = { converted: false };
  it("allows moving forward and backward between open stages", () => {
    expect(stageChangeError({ ...base, from: "NEW", to: "CONTACTED" })).toBeNull();
    expect(stageChangeError({ ...base, from: "OFFER_SENT", to: "CONTACTED" })).toBeNull();
  });
  it("Won only through conversion", () => expect(stageChangeError({ ...base, from: "OFFER_SENT", to: "WON" })).toMatch(/Convert/));
  it("Lost needs a reason", () => {
    expect(stageChangeError({ ...base, from: "NEW", to: "LOST" })).toMatch(/reason/);
    expect(stageChangeError({ ...base, from: "NEW", to: "LOST", lostReason: "  " })).toMatch(/reason/);
    expect(stageChangeError({ ...base, from: "NEW", to: "LOST", lostReason: "Too costly" })).toBeNull();
  });
  it("a Lost lead can be reopened", () => expect(stageChangeError({ ...base, from: "LOST", to: "NEW" })).toBeNull());
  it("a converted lead can't change", () => expect(stageChangeError({ converted: true, from: "WON", to: "NEW" })).toMatch(/converted/));
  it("same stage is rejected", () => expect(stageChangeError({ ...base, from: "NEW", to: "NEW" })).toMatch(/already/));
});

const client = {
  companyName: "Test Pvt Ltd", phone: "", whatsapp: "", email: "", website: "", sectorId: "", city: "", country: "India", stateCode: "27",
  billingAddress: "", pincode: "", gstin: "", pan: "", leadSourceId: "", accountManagerId: "", tags: "", notes: "", status: "ACTIVE" as const,
};

describe("client GST validation", () => {
  it("fills the state name from the code", () => {
    expect(clientSchema.parse({ ...client, stateCode: "29" }).state).toBe("Karnataka");
  });
  it("accepts a matching GSTIN and PAN, in any case", () => {
    const r = clientSchema.parse({ ...client, gstin: "27aaeck4521m1z8", pan: "aaeck4521m" });
    expect(r.gstin).toBe("27AAECK4521M1Z8");
    expect(r.pan).toBe("AAECK4521M");
  });
  it("rejects a badly formatted GSTIN", () => expect(clientSchema.safeParse({ ...client, gstin: "12345" }).success).toBe(false));
  it("rejects a GSTIN from a different state", () => {
    const r = clientSchema.safeParse({ ...client, stateCode: "27", gstin: "29AAFCV2231H1Z6" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/state code 29/);
  });
  it("rejects a PAN that doesn't match the GSTIN", () => {
    expect(clientSchema.safeParse({ ...client, gstin: "27AAECK4521M1Z8", pan: "ABCDE1234F" }).success).toBe(false);
  });
  it("requires a real state in India", () => expect(clientSchema.safeParse({ ...client, stateCode: "99" }).success).toBe(false));
  it("clients abroad need no state and get the foreign code", () => {
    const r = clientSchema.parse({ ...client, country: "UAE", stateCode: "" });
    expect(r.stateCode).toBe("96");
    expect(r.state).toBe("Outside India");
  });
  it("clients abroad can't have a GSTIN", () => {
    expect(clientSchema.safeParse({ ...client, country: "UAE", gstin: "27AAECK4521M1Z8" }).success).toBe(false);
  });
  it("splits and de-duplicates tags", () => {
    expect(clientSchema.parse({ ...client, tags: "retainer, B2B ,retainer,," }).tags).toEqual(["retainer", "B2B"]);
  });
});

describe("lead validation", () => {
  const lead = { contactName: "Rahul", servicesInterested: [] };
  it("needs a way to reach them", () => expect(leadSchema.safeParse(lead).success).toBe(false));
  it("any one of phone, WhatsApp or email is enough", () => {
    expect(leadSchema.safeParse({ ...lead, phone: "9823011452" }).success).toBe(true);
    expect(leadSchema.safeParse({ ...lead, email: "a@b.in" }).success).toBe(true);
  });
  it("rejects an impossible follow-up date", () => {
    expect(leadSchema.safeParse({ ...lead, phone: "9823011452", nextFollowUpDate: "2026-02-31" }).success).toBe(false);
  });
});

describe("money and phone inputs", () => {
  it("keeps exact paise as text", () => expect(moneyString.parse("₹1,25,000.50")).toBe("125000.50"));
  it("rejects more than 2 decimals, negatives and words", () => {
    for (const bad of ["10.555", "-5", "abc", ""]) expect(moneyString.safeParse(bad).success).toBe(false);
  });
  it("blank optional amount becomes null", () => {
    expect(optionalMoney.parse("")).toBeNull();
    expect(optionalMoney.parse(undefined)).toBeNull();
    expect(optionalMoney.parse(null)).toBeNull();
  });
  it("checks phone numbers", () => {
    expect(optionalPhone.parse("+91 98230 11452")).toBe("+91 98230 11452");
    expect(optionalPhone.safeParse("12345").success).toBe(false);
    expect(optionalPhone.safeParse("call me").success).toBe(false);
  });
});

describe("safe links", () => {
  it("adds https to plain websites", () => expect(safeExternalUrl("rezonest.com")).toBe("https://rezonest.com/"));
  it("keeps http and https", () => expect(safeExternalUrl("http://a.in/x")).toBe("http://a.in/x"));
  it("blocks scripts", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
  });
  it("blank stays blank", () => expect(safeExternalUrl("  ")).toBeNull());
});

describe("CSV reading", () => {
  it("handles quotes, commas and line breaks", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n"two\nlines",z')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["two\nlines", "z"]]);
  });
  it("handles Windows line endings and Excel's BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps blank cells", () => expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]));
});

describe("import dates (always day first)", () => {
  it.each([
    ["03/04/2026", "2026-04-03"],
    ["3/4/2026", "2026-04-03"],
    ["15-11-2026", "2026-11-15"],
    ["15.11.2026", "2026-11-15"],
    ["15 Nov 2026", "2026-11-15"],
    ["15 November 2026", "2026-11-15"],
    ["2026-11-15", "2026-11-15"],
  ])("%s → %s", (input, expected) => expect(parseImportDate(input)).toBe(expected));
  it.each(["31/02/2026", "13/13/2026", "tomorrow", "11/2026", ""])("rejects %s", (bad) => expect(parseImportDate(bad)).toBeNull());
});

describe("import column matching", () => {
  it("recognises common headings in any case", () => {
    const { mapping, ignored } = mapHeaders(["Company Name", "MOBILE", "E-mail", "Favourite Colour", ""], CLIENT_FIELDS);
    expect(mapping).toEqual({ 0: "companyName", 1: "phone", 2: "email" });
    expect(ignored).toEqual(["Favourite Colour"]);
  });
  it("the first matching column wins", () => {
    const { mapping, ignored } = mapHeaders(["Phone", "Mobile"], LEAD_FIELDS);
    expect(mapping).toEqual({ 0: "phone" });
    expect(ignored).toEqual(["Mobile"]);
  });
});

const refs: ImportRefs = {
  sectors: [{ id: "s1", name: "IT & Services" }],
  sources: [{ id: "src1", name: "Referral" }],
  services: [{ id: "svc1", name: "SEO Services" }],
};

describe("import: lead rows", () => {
  const row = (values: Record<string, string>) => ({ rowNumber: 2, values });
  it("a good row is ready, with names turned into ids", () => {
    const r = analyseLeadRow(row({ contactName: "Rahul", phone: "9823011452", sector: "it & services", source: "Referral", services: "SEO Services", budget: "₹25,000", followUp: "15/11/2026" }), refs);
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ sectorId: "s1", leadSourceId: "src1", servicesInterested: ["svc1"], approxBudget: "25000", nextFollowUpDate: "2026-11-15" });
  });
  it("unknown list values warn but don't block", () => {
    const r = analyseLeadRow(row({ contactName: "Rahul", phone: "9823011452", sector: "Space", services: "Magic" }), refs);
    expect(r.data).not.toBeNull();
    expect(r.warnings).toHaveLength(2);
  });
  it("bad data is an error and the row is not imported", () => {
    const r = analyseLeadRow(row({ contactName: "Rahul", phone: "9823011452", followUp: "someday" }), refs);
    expect(r.data).toBeNull();
    expect(r.errors[0]).toMatch(/valid date/);
    expect(analyseLeadRow(row({ phone: "9823011452" }), refs).data).toBeNull();
    expect(analyseLeadRow(row({ contactName: "Rahul" }), refs).data).toBeNull();
    expect(analyseLeadRow(row({ contactName: "Rahul", phone: "98", budget: "lots" }), refs).errors.length).toBe(2);
  });
});

describe("import: client rows and GST", () => {
  const row = (values: Record<string, string>) => ({ rowNumber: 2, values });
  it("takes the state from the GSTIN when none is given", () => {
    const r = analyseClientRow(row({ companyName: "Vertex", gstin: "29AAFCV2231H1Z6" }), refs);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.data).toMatchObject({ state: "Karnataka", stateCode: "29" });
  });
  it("with no state and no GSTIN, assumes Maharashtra and says so", () => {
    const r = analyseClientRow(row({ companyName: "Local Co" }), refs);
    expect(r.data).toMatchObject({ stateCode: "27" });
    expect(r.warnings[0]).toMatch(/Maharashtra is assumed/);
  });
  it("an unknown state is an error, not a guess", () => {
    const r = analyseClientRow(row({ companyName: "Local Co", state: "Mars" }), refs);
    expect(r.data).toBeNull();
    expect(r.errors).toEqual(["“Mars” isn't a recognised Indian state"]);
  });
  it("a state that contradicts the GSTIN is an error", () => {
    expect(analyseClientRow(row({ companyName: "Vertex", state: "Maharashtra", gstin: "29AAFCV2231H1Z6" }), refs).data).toBeNull();
  });
  it("the state can be a code", () => {
    expect(analyseClientRow(row({ companyName: "Goa Co", state: "30" }), refs).data).toMatchObject({ state: "Goa" });
  });
  it("uses the company name as the contact if none is given", () => {
    expect(analyseClientRow(row({ companyName: "Solo Co" }), refs).data).toMatchObject({ contactName: "Solo Co" });
  });
  it("foreign clients skip Indian state rules", () => {
    expect(analyseClientRow(row({ companyName: "Dubai LLC", country: "UAE" }), refs).data).toMatchObject({ stateCode: "96" });
  });
});

describe("import: duplicates", () => {
  const analyse = (r: { rowNumber: number; values: Record<string, string> }) => analyseLeadRow(r, refs);
  const existing: Contactable[] = [{ id: "c1", name: "Kalyani", kind: "client", phones: ["9823011452"], emails: [] }];

  it("flags a match with existing records", () => {
    const [r] = analyseRows([{ rowNumber: 2, values: { contactName: "Sanjay", phone: "+91 98230 11452" } }], analyse, existing);
    expect(r.duplicates[0].id).toBe("c1");
  });
  it("flags a repeat within the same file", () => {
    const rows = analyseRows(
      [
        { rowNumber: 2, values: { contactName: "Asha", email: "asha@x.in" } },
        { rowNumber: 3, values: { contactName: "Asha K", email: "ASHA@x.in" } },
      ],
      analyse,
      [],
    );
    expect(rows[0].duplicates).toEqual([]);
    expect(rows[1].duplicates[0].name).toBe("row 2 of this file");
  });
  it("a row with errors doesn't count as the original", () => {
    const rows = analyseRows(
      [
        { rowNumber: 2, values: { contactName: "A", email: "asha@x.in" } },
        { rowNumber: 3, values: { contactName: "Asha", email: "asha@x.in" } },
      ],
      analyse,
      [],
    );
    expect(rows[0].data).toBeNull();
    expect(rows[1].duplicates).toEqual([]);
  });
});

describe("service catalogue validation", () => {
  const service = {
    name: "SEO", departmentId: "", billingType: "MONTHLY_RETAINER" as const, defaultPrice: "15000", unit: "month", gstRate: "18", sacCode: "",
    revisionsIncluded: 2, isActive: true, defaultKpis: [], defaultDeliverables: [],
  };
  it("accepts a normal service", () => expect(serviceSchema.safeParse(service).success).toBe(true));
  it("checks GST rate and SAC code", () => {
    expect(serviceSchema.safeParse({ ...service, gstRate: "29" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...service, gstRate: "-1" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...service, sacCode: "99" }).success).toBe(false);
    expect(serviceSchema.parse({ ...service, sacCode: "998361" }).sacCode).toBe("998361");
  });
  it("sub-service names can't repeat", () => {
    const item = { name: "Reel", billingType: "" as const, defaultPrice: "", unit: "", isActive: true };
    expect(subServicesSchema.safeParse({ serviceId: "s", items: [item, { ...item, name: "reel" }] }).success).toBe(false);
  });
  it("a template needs at least one step", () => {
    expect(taskTemplateSchema.safeParse({ serviceId: "s", name: "Reel", isActive: true, steps: [] }).success).toBe(false);
  });
  it("makes tidy web addresses", () => expect(slugify("Graphic Design & Video!")).toBe("graphic-design-and-video"));
});

describe("list URL parameters", () => {
  const opts = { sorts: ["name", "date"] as const, defaultSort: "date" as const, defaultDir: "desc" as const };
  it("uses defaults", () => expect(parseListParams({}, opts)).toEqual({ q: "", page: 1, pageSize: 25, sort: "date", dir: "desc" }));
  it("reads valid values", () => {
    expect(parseListParams({ q: " abc ", page: "3", size: "50", sort: "name", dir: "asc" }, opts)).toEqual({ q: "abc", page: 3, pageSize: 50, sort: "name", dir: "asc" });
  });
  it("ignores anything unexpected", () => {
    expect(parseListParams({ page: "-1", size: "9999", sort: "password", dir: "sideways" }, opts)).toEqual({ q: "", page: 1, pageSize: 25, sort: "date", dir: "desc" });
  });
});
