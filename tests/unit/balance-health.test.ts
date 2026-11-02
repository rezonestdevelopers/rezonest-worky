import { describe, expect, it } from "vitest";
import { ageingBucket, computePaymentStatus, invoiceBalance } from "@/lib/money/balance";
import { computeProjectHealth, effectiveHealth } from "@/lib/health";
import { can } from "@/lib/permissions";

const base = {
  status: "ISSUED" as const,
  grandTotal: "59000",
  amountPaid: "0",
  tdsTotal: "0",
  creditedTotal: "0",
  dueDateKey: "2026-11-15",
  todayKey: "2026-11-02",
};

describe("invoice balance & payment status", () => {
  it("balance = total − paid − TDS − credit notes", () => {
    expect(invoiceBalance({ grandTotal: "59000", amountPaid: "50000", tdsTotal: "1000", creditedTotal: "3000" }).toFixed(2)).toBe("5000.00");
  });
  it("never negative", () => {
    expect(invoiceBalance({ grandTotal: "100", amountPaid: "150", tdsTotal: 0, creditedTotal: 0 }).toFixed(2)).toBe("0.00");
  });
  it("UNPAID before due date", () => expect(computePaymentStatus(base)).toBe("UNPAID"));
  it("not overdue ON the due date", () => expect(computePaymentStatus({ ...base, todayKey: "2026-11-15" })).toBe("UNPAID"));
  it("OVERDUE the day after due date", () => expect(computePaymentStatus({ ...base, todayKey: "2026-11-16" })).toBe("OVERDUE"));
  it("PARTIALLY_PAID", () => expect(computePaymentStatus({ ...base, amountPaid: "20000" })).toBe("PARTIALLY_PAID"));
  it("PAID when TDS covers the remainder", () =>
    expect(computePaymentStatus({ ...base, amountPaid: "57820", tdsTotal: "1180" })).toBe("PAID"));
  it("PAID even after due date", () =>
    expect(computePaymentStatus({ ...base, amountPaid: "59000", todayKey: "2027-01-01" })).toBe("PAID"));
  it("partially paid but past due → OVERDUE", () =>
    expect(computePaymentStatus({ ...base, amountPaid: "1000", todayKey: "2026-12-01" })).toBe("OVERDUE"));
  it("CANCELLED wins", () => expect(computePaymentStatus({ ...base, status: "CANCELLED" })).toBe("CANCELLED"));
});

describe("ageing buckets", () => {
  it.each([
    [-5, "0-30"], [0, "0-30"], [30, "0-30"], [31, "31-60"], [60, "31-60"], [61, "61-90"], [90, "61-90"], [91, "90+"],
  ] as const)("%s days → %s", (d, b) => expect(ageingBucket(d)).toBe(b));
});

describe("project health", () => {
  const ok = {
    todayKey: "2026-11-02",
    openTasks: 10,
    overdueTasks: 0,
    missedMilestones: 0,
    milestonesDueSoon: 0,
    deadlineKey: "2026-12-31",
    progressPercent: 40,
  };
  it("ON_TRACK with nothing overdue", () => expect(computeProjectHealth(ok)).toBe("ON_TRACK"));
  it("AT_RISK with one overdue task", () => expect(computeProjectHealth({ ...ok, overdueTasks: 1 })).toBe("AT_RISK"));
  it("DELAYED with 3 overdue tasks", () => expect(computeProjectHealth({ ...ok, overdueTasks: 3, openTasks: 20 })).toBe("DELAYED"));
  it("DELAYED when ≥25% of open tasks overdue", () => expect(computeProjectHealth({ ...ok, overdueTasks: 2, openTasks: 8 })).toBe("DELAYED"));
  it("DELAYED with a missed milestone", () => expect(computeProjectHealth({ ...ok, missedMilestones: 1 })).toBe("DELAYED"));
  it("DELAYED after deadline", () => expect(computeProjectHealth({ ...ok, deadlineKey: "2026-11-01" })).toBe("DELAYED"));
  it("AT_RISK: deadline in 5 days, 60% done", () =>
    expect(computeProjectHealth({ ...ok, deadlineKey: "2026-11-07", progressPercent: 60 })).toBe("AT_RISK"));
  it("ON_TRACK: deadline in 5 days, 90% done", () =>
    expect(computeProjectHealth({ ...ok, deadlineKey: "2026-11-07", progressPercent: 90 })).toBe("ON_TRACK"));
  it("completed projects are ON_TRACK", () =>
    expect(computeProjectHealth({ ...ok, missedMilestones: 2, isCompleted: true })).toBe("ON_TRACK"));
  it("manual override wins", () => expect(effectiveHealth("DELAYED", "ON_TRACK")).toBe("ON_TRACK"));
  it("no override → auto", () => expect(effectiveHealth("AT_RISK", null)).toBe("AT_RISK"));
});

describe("permissions", () => {
  it("admin can do everything", () => {
    expect(can("ADMIN", "finance.manage")).toBe(true);
    expect(can("ADMIN", "settings.manage")).toBe(true);
  });
  it("manager has no money/profit/settings", () => {
    expect(can("MANAGER", "dashboard.full")).toBe(true);
    expect(can("MANAGER", "dashboard.profit")).toBe(false);
    expect(can("MANAGER", "finance.manage")).toBe(false);
    expect(can("MANAGER", "settings.manage")).toBe(false);
  });
  it("employee only own work", () => {
    expect(can("EMPLOYEE", "work.own")).toBe(true);
    expect(can("EMPLOYEE", "sales.manage")).toBe(false);
    expect(can("EMPLOYEE", "dashboard.full")).toBe(false);
  });
  it("no role → nothing", () => expect(can(undefined, "work.own")).toBe(false));
});
