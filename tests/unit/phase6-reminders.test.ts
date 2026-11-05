import { describe, expect, it } from "vitest";
import { ALERT_CATEGORIES, categoryOfType, digestDue, digestSections, digestSummary, digestText, MONEY_TYPES, nextReminderState, typesOfCategory, type DigestAlert } from "@/lib/alerts";
import { istTime } from "@/lib/dates";
import { fillPlaceholders, renderTemplate, TEMPLATE_DEFINITIONS, templateDefinition, unknownPlaceholders } from "@/lib/email-templates";

const now = new Date("2026-11-05T10:00:00Z");
const row = (status: "OPEN" | "SNOOZED" | "DONE", over: Partial<{ snoozedUntil: Date | null; doneManually: boolean }> = {}) => ({ status, snoozedUntil: null, doneManually: false, ...over });

describe("what a run does to a reminder", () => {
  it("keeps an open one open while the situation lasts, and closes it when it's gone", () => {
    expect(nextReminderState(row("OPEN"), true, now)).toBe("OPEN");
    expect(nextReminderState(row("OPEN"), false, now)).toBe("DONE");
  });
  it("keeps a snooze until its time, then wakes it", () => {
    expect(nextReminderState(row("SNOOZED", { snoozedUntil: new Date("2026-11-06T00:00:00Z") }), true, now)).toBe("SNOOZED");
    expect(nextReminderState(row("SNOOZED", { snoozedUntil: new Date("2026-11-04T00:00:00Z") }), true, now)).toBe("OPEN");
    expect(nextReminderState(row("SNOOZED", { snoozedUntil: new Date("2026-11-06T00:00:00Z") }), false, now)).toBe("DONE");
  });
  it("never undoes someone's Done, but reopens one that closed by itself if it comes back", () => {
    expect(nextReminderState(row("DONE", { doneManually: true }), true, now)).toBe("DONE");
    expect(nextReminderState(row("DONE"), true, now)).toBe("OPEN");
    expect(nextReminderState(row("DONE"), false, now)).toBe("DONE");
  });
});

describe("reminder types", () => {
  it("every type belongs to a category that exists, and money types stay in money categories", () => {
    for (const key of Object.keys(ALERT_CATEGORIES)) expect(typesOfCategory(key).length).toBeGreaterThan(0);
    expect(categoryOfType("TASK_DUE_SOON")).toBe("due_soon");
    expect(categoryOfType("PROJECT_DEADLINE")).toBe("deadline");
    expect(MONEY_TYPES).toEqual(expect.arrayContaining(["PAYMENT_OVERDUE", "INVOICE_DUE"]));
  });
});

describe("the digest", () => {
  const alert = (category: DigestAlert["category"], severity: string, title: string, detail: string | null = null): DigestAlert => ({ category, severity, title, detail });
  it("puts sections in order, most urgent first, leaving out empty ones", () => {
    const s = digestSections([alert("renewal", "CRITICAL", "Domain"), alert("overdue", "WARNING", "Late"), alert("overdue", "CRITICAL", "Very late")]);
    expect(s.map((x) => x.title)).toEqual(["Overdue tasks", "Renewals"]);
    expect(s[0].lines).toEqual(["Very late", "Late"]);
  });
  it("keeps long sections short and says how many more", () => {
    const [s] = digestSections(Array.from({ length: 20 }, (_, i) => alert("overdue", "WARNING", `Task ${i}`)), 15);
    expect(s.total).toBe(20);
    expect(s.lines).toHaveLength(15);
    expect(s.more).toBe(5);
    expect(digestText([s])).toContain("...and 5 more");
    expect(digestText([s])).toContain("OVERDUE TASKS (20)");
  });
  it("includes the details on each line", () => {
    expect(digestText(digestSections([alert("renewal", "INFO", "Domain expires", "Asha Foods")]))).toContain("- Domain expires: Asha Foods");
  });
  it("sums up with the right words", () => {
    expect(digestSummary([])).toBe("All clear today");
    expect(digestSummary([alert("overdue", "CRITICAL", "A")])).toBe("1 needs attention");
    expect(digestSummary([alert("overdue", "WARNING", "A"), alert("overdue", "CRITICAL", "B"), alert("due_today", "INFO", "C")])).toBe("2 need attention");
    expect(digestSummary([alert("due_today", "INFO", "C")])).toBe("1 for your information");
  });
  it("goes at or after the digest time, in IST", () => {
    expect(digestDue("08:59", "09:00")).toBe(false);
    expect(digestDue("09:00", "09:00")).toBe(true);
    expect(digestDue("23:10", "09:00")).toBe(true);
    expect(istTime(new Date("2026-11-05T03:30:00Z"))).toBe("09:00");
    expect(istTime(new Date("2026-11-05T18:29:00Z"))).toBe("23:59");
    expect(istTime(new Date("2026-11-05T18:30:00Z"))).toBe("00:00");
  });
});

describe("email templates", () => {
  it("fills placeholders, and blanks anything unknown", () => {
    expect(fillPlaceholders("Hello {{name}}, {{nope}}!", { name: "Asha" })).toBe("Hello Asha, !");
  });
  it("gives a WhatsApp version only when there is one", () => {
    expect(renderTemplate({ subject: "S {{a}}", body: "B {{a}}", whatsapp: "W {{a}}" }, { a: "1" })).toEqual({ subject: "S 1", text: "B 1", whatsapp: "W 1" });
    expect(renderTemplate({ subject: "S", body: "B", whatsapp: null }, {}).whatsapp).toBeNull();
  });
  it("catches a misspelt placeholder, ignoring spaces", () => {
    expect(unknownPlaceholders("offer_send", "{{offerNumber}} {{offerNumbr}} {{ contactName }} {{ bad name }}")).toEqual(["offerNumbr", "bad name"]);
    expect(unknownPlaceholders("offer_send", "No placeholders")).toEqual([]);
  });
  it("every starting template only uses its own placeholders, and has an example for each", () => {
    for (const t of TEMPLATE_DEFINITIONS) {
      expect(unknownPlaceholders(t.key, [t.subject, t.body, t.whatsapp ?? ""].join("\n")), t.key).toEqual([]);
      const rendered = renderTemplate(t, t.placeholders);
      expect(rendered.text, t.key).not.toContain("{{");
      expect(rendered.subject, t.key).not.toContain("{{");
    }
    expect(new Set(TEMPLATE_DEFINITIONS.map((t) => t.key)).size).toBe(TEMPLATE_DEFINITIONS.length);
    expect(templateDefinition("nope")).toBeUndefined();
  });
  it("includes the three payment reminder levels from the brief", () => {
    for (const k of ["payment_reminder_polite", "payment_reminder_firm", "payment_reminder_final"]) expect(templateDefinition(k)?.whatsapp).toBeTruthy();
  });
});
