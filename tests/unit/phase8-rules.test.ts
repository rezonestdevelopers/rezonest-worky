import { describe, expect, it } from "vitest";
import { canPreview, documentType, formatFileSize, isFinanceDocument } from "@/lib/file-types";
import { buildProfit, expenseCategoryLabel, lastMonths, monthlyRevenueVsExpenses, periodRange, profitOf, timeCost } from "@/lib/profit";
import { communicationSchema, expenseSchema } from "@/lib/validators/expense";

describe("profit", () => {
  it("is revenue less expenses and team time", () => {
    const p = profitOf({ revenue: "100000", expenses: "20000", time: "5000.50" });
    expect(p.profit.toString()).toBe("74999.5");
    expect(p.marginPercent).toBe(75);
  });
  it("can be a loss", () => {
    const p = profitOf({ revenue: "1000", expenses: "1500", time: 0 });
    expect(p.profit.toString()).toBe("-500");
    expect(p.marginPercent).toBe(-50);
  });
  it("has no margin without revenue", () => {
    expect(profitOf({ revenue: 0, expenses: "500", time: 0 }).marginPercent).toBeNull();
  });
  it("doesn't drift on paise", () => {
    expect(profitOf({ revenue: "0.30", expenses: "0.10", time: "0.20" }).profit.toString()).toBe("0");
  });
});

describe("team time cost", () => {
  it("is minutes at the hourly rate", () => {
    expect(timeCost(90, "500").toString()).toBe("750");
    expect(timeCost(45, "1000").toString()).toBe("750");
  });
  it("is nothing when no rate is set", () => {
    expect(timeCost(600, null).toString()).toBe("0");
  });
});

describe("profit per client and project", () => {
  const r = buildProfit({
    invoices: [
      { clientId: "a", projectId: "p1", taxable: "10000" },
      { clientId: "a", projectId: null, taxable: "2000" },
      { clientId: "b", projectId: "p2", taxable: "5000" },
    ],
    credits: [{ clientId: "a", projectId: "p1", taxable: "1000" }],
    expenses: [
      { clientId: "a", projectId: "p1", amount: "3000" },
      { clientId: "a", projectId: null, amount: "500" },
      { clientId: null, projectId: null, amount: "7000" },
    ],
    time: [
      { clientId: "a", projectId: "p1", minutes: 60, hourlyCost: "600" },
      { clientId: null, projectId: null, minutes: 60, hourlyCost: "600" },
      { clientId: "b", projectId: "p2", minutes: 120, hourlyCost: null },
    ],
  });
  const row = (rows: typeof r.clients, id: string) => rows.find((x) => x.id === id)!;

  it("a client gets everything linked to it, project or not", () => {
    const a = row(r.clients, "a");
    expect([a.revenue, a.expenses, a.time, a.profit].map(String)).toEqual(["11000", "3500", "600", "6900"]);
  });
  it("a project only gets what's linked to that project", () => {
    const p = row(r.projects, "p1");
    expect([p.revenue, p.expenses, p.time, p.profit].map(String)).toEqual(["9000", "3000", "600", "5400"]);
  });
  it("overheads stay separate, on no one's row", () => {
    expect(r.overheads.toString()).toBe("7000");
    expect(r.clients.map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("sorts best first", () => {
    expect(r.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
  it("credit notes lower revenue, even below zero", () => {
    const only = buildProfit({ invoices: [], credits: [{ clientId: "a", projectId: null, taxable: "100" }], expenses: [], time: [] });
    expect(only.clients[0].revenue.toString()).toBe("-100");
    expect(only.clients[0].marginPercent).toBeNull();
  });
});

describe("monthly revenue vs expenses", () => {
  it("adds up each month, leaving out anything else", () => {
    const rows = monthlyRevenueVsExpenses({
      months: ["2026-10", "2026-11"],
      invoices: [{ dateKey: "2026-10-05", taxable: "1000" }, { dateKey: "2026-11-05", taxable: "2000" }, { dateKey: "2026-09-30", taxable: "9999" }],
      credits: [{ dateKey: "2026-11-06", taxable: "100" }],
      expenses: [{ dateKey: "2026-11-07", amount: "500" }],
    });
    expect(rows.map((x) => [x.month, x.revenue.toString(), x.expenses.toString(), x.net.toString()])).toEqual([
      ["2026-10", "1000", "0", "1000"],
      ["2026-11", "1900", "500", "1400"],
    ]);
  });
  it("lists the last months, oldest first, across a year end", () => {
    expect(lastMonths("2027-01-15", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("periods", () => {
  it("this month, last month", () => {
    expect(periodRange("month", "2026-11-05")).toEqual({ key: "month", from: "2026-11-01", to: "2026-11-05" });
    expect(periodRange("last-month", "2026-03-10")).toEqual({ key: "last-month", from: "2026-02-01", to: "2026-02-28" });
  });
  it("financial years run April to March", () => {
    expect(periodRange("fy", "2026-11-05")).toMatchObject({ from: "2026-04-01", to: "2026-11-05" });
    expect(periodRange("fy", "2027-03-31")).toMatchObject({ from: "2026-04-01" });
    expect(periodRange("fy", "2027-04-01")).toMatchObject({ from: "2027-04-01" });
    expect(periodRange("last-fy", "2026-11-05")).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("all time has no start, and rubbish means this year", () => {
    expect(periodRange("all", "2026-11-05")).toEqual({ key: "all", from: null, to: "2026-11-05" });
    expect(periodRange("<script>", "2026-11-05").key).toBe("fy");
    expect(periodRange(null, "2026-11-05").key).toBe("fy");
  });
});

describe("file checks", () => {
  const pdf = Buffer.from("%PDF-1.7 rest");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const zip = Buffer.from("PK\u0003\u0004rest");
  it("goes by what's inside, not the name", () => {
    expect(documentType(pdf, "anything.txt")).toEqual({ ext: "pdf", mime: "application/pdf" });
    expect(documentType(png, "photo.pdf")).toEqual({ ext: "png", mime: "image/png" });
  });
  it("takes Office files only with an Office name", () => {
    expect(documentType(zip, "brief.docx")?.ext).toBe("docx");
    expect(documentType(zip, "tool.zip")).toBeNull();
  });
  it("refuses web pages and programs dressed up as documents", () => {
    expect(documentType(Buffer.from("<html><script>alert(1)</script>"), "agreement.pdf")).toBeNull();
    expect(documentType(Buffer.from("<svg onload=alert(1)>"), "logo.png")).toBeNull();
    expect(documentType(Buffer.from("MZ\u0090"), "setup.docx")).toBeNull();
  });
  it("previews only PDFs and images", () => {
    expect(canPreview("application/pdf")).toBe(true);
    expect(canPreview("image/jpeg")).toBe(true);
    expect(canPreview("application/octet-stream")).toBe(false);
    expect(canPreview("text/html")).toBe(false);
    expect(canPreview("image/svg+xml")).toBe(false);
  });
  it("keeps bills and invoices for people who see money", () => {
    expect(isFinanceDocument("BILL")).toBe(true);
    expect(isFinanceDocument("INVOICE")).toBe(true);
    expect(isFinanceDocument("AGREEMENT")).toBe(false);
  });
  it("shows sizes plainly", () => {
    expect(formatFileSize(500)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("expense form checks", () => {
  const e = { date: "2026-11-05", category: "TRAVEL", description: "Client visit", vendor: "", amount: "1,500.50", gstPaid: "", clientId: "", projectId: "" };
  it("accepts a good one, and cleans the amount", () => {
    const parsed = expenseSchema.parse(e);
    expect(parsed.amount).toBe("1500.50");
    expect(parsed.gstPaid).toBeNull();
    expect(parsed.clientId).toBeNull();
  });
  it("needs an amount above zero and a real category", () => {
    expect(expenseSchema.safeParse({ ...e, amount: "0" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, amount: "-5" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, category: "BRIBES" }).success).toBe(false);
  });
  it("needs a description and a real date", () => {
    expect(expenseSchema.safeParse({ ...e, description: "" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, date: "2026-02-31" }).success).toBe(false);
  });
  it("names the labels you see", () => {
    expect(expenseCategoryLabel("DOMAIN_HOSTING")).toBe("Domain & hosting cost");
  });
});

describe("communication form checks", () => {
  const c = { clientId: "c1", leadId: "", type: "CALL", date: "2026-11-05", summary: "Discussed the plan", nextAction: "", nextActionDate: "" };
  it("accepts a plain note", () => {
    expect(communicationSchema.safeParse(c).success).toBe(true);
  });
  it("belongs to exactly one client or lead", () => {
    expect(communicationSchema.safeParse({ ...c, clientId: "" }).success).toBe(false);
    expect(communicationSchema.safeParse({ ...c, leadId: "l1" }).success).toBe(false);
    expect(communicationSchema.safeParse({ ...c, clientId: "", leadId: "l1" }).success).toBe(true);
  });
  it("a next action and its date go together, or no reminder could fire", () => {
    expect(communicationSchema.safeParse({ ...c, nextAction: "Send quote" }).success).toBe(false);
    expect(communicationSchema.safeParse({ ...c, nextActionDate: "2026-11-09" }).success).toBe(false);
    expect(communicationSchema.safeParse({ ...c, nextAction: "Send quote", nextActionDate: "2026-11-09" }).success).toBe(true);
  });
});
