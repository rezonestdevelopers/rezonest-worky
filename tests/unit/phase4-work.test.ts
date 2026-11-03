import { describe, expect, it } from "vitest";
import { convertOfferSchema, employeeSchema, onboardingLinesSchema, projectSchema, taskSchema, timeLogSchema } from "@/lib/validators/work";
import {
  addWorkingDays,
  findMentions,
  isWorkingDay,
  onboardingPercent,
  planBackward,
  planForward,
  renewedEnd,
  retainerEndKey,
  revisionsExceeded,
  spreadDates,
  taskStatusError,
  toWorkingDay,
  unitSets,
  type PlanStep,
} from "@/lib/work-plan";

const MON_SAT = [1, 2, 3, 4, 5, 6];
const step = (title: string, durationDays = 1): PlanStep => ({ title, durationDays, departmentId: null, priority: "MEDIUM", isClientApproval: false });

describe("working days", () => {
  it("knows Sunday is off in a Monday to Saturday week", () => {
    expect(isWorkingDay("2026-11-07", MON_SAT)).toBe(true); // Saturday
    expect(isWorkingDay("2026-11-08", MON_SAT)).toBe(false); // Sunday
  });
  it("moves off a day off in the right direction", () => {
    expect(toWorkingDay("2026-11-08", MON_SAT)).toBe("2026-11-09");
    expect(toWorkingDay("2026-11-08", MON_SAT, -1)).toBe("2026-11-07");
  });
  it("skips days off when counting", () => {
    expect(addWorkingDays("2026-11-07", 1, MON_SAT)).toBe("2026-11-09");
    expect(addWorkingDays("2026-11-09", -1, MON_SAT)).toBe("2026-11-07");
    expect(addWorkingDays("2026-11-06", 5, [1, 2, 3, 4, 5])).toBe("2026-11-13");
  });
  it("doesn't hang if no working days are set", () => {
    expect(toWorkingDay("2026-11-08", [])).toBe("2026-11-08");
  });
});

describe("planning tasks", () => {
  it("runs steps one after another from the start date", () => {
    const plan = planForward([step("A", 2), step("B", 1), step("C", 3)], "2026-11-06", MON_SAT);
    expect(plan.map((p) => [p.startKey, p.dueKey])).toEqual([
      ["2026-11-06", "2026-11-07"],
      ["2026-11-09", "2026-11-09"],
      ["2026-11-10", "2026-11-12"],
    ]);
  });
  it("starts on the next working day if the start date is a day off", () => {
    expect(planForward([step("A")], "2026-11-08", MON_SAT)[0].startKey).toBe("2026-11-09");
  });
  it("plans backwards so the last step lands on the due date", () => {
    const plan = planBackward([step("Edit", 2), step("Post")], "2026-11-20", "2026-11-01", MON_SAT);
    expect(plan.map((p) => p.title)).toEqual(["Edit", "Post"]);
    expect(plan[1].dueKey).toBe("2026-11-20");
    expect(plan[0].dueKey).toBe("2026-11-19");
    expect(plan[0].startKey).toBe("2026-11-18");
  });
  it("never starts before the earliest day, even when squeezed", () => {
    const plan = planBackward([step("A", 3), step("B", 3), step("C")], "2026-11-03", "2026-11-02", MON_SAT);
    for (const p of plan) {
      expect(p.startKey >= "2026-11-02").toBe(true);
      expect(p.dueKey >= p.startKey).toBe(true);
    }
    expect(plan[2].dueKey).toBe("2026-11-03");
  });
});

describe("spreading deliverables across a month", () => {
  it("gives the right number of dates, all in the period and on working days", () => {
    const dates = spreadDates("2026-11-01", "2026-11-30", 12, MON_SAT);
    expect(dates).toHaveLength(12);
    for (const d of dates) {
      expect(d >= "2026-11-01" && d <= "2026-11-30").toBe(true);
      expect(isWorkingDay(d, MON_SAT)).toBe(true);
    }
    expect([...dates].sort()).toEqual(dates);
  });
  it("works when the period starts mid-month or is one day", () => {
    expect(spreadDates("2026-11-20", "2026-11-30", 3, MON_SAT).every((d) => d >= "2026-11-20")).toBe(true);
    expect(spreadDates("2026-11-30", "2026-11-30", 2, MON_SAT)).toEqual(["2026-11-30", "2026-11-30"]);
  });
  it("gives nothing for zero items", () => {
    expect(spreadDates("2026-11-01", "2026-11-30", 0, MON_SAT)).toEqual([]);
  });
});

describe("task rules", () => {
  it("needs a reason for Blocked, and allows moving back", () => {
    expect(taskStatusError({ from: "TODO", to: "BLOCKED" })).toMatch(/blocking/);
    expect(taskStatusError({ from: "TODO", to: "BLOCKED", blockedReason: "ok" })).toMatch(/blocking/);
    expect(taskStatusError({ from: "TODO", to: "BLOCKED", blockedReason: "No logo yet" })).toBeNull();
    expect(taskStatusError({ from: "DONE", to: "IN_PROGRESS" })).toBeNull();
    expect(taskStatusError({ from: "DONE", to: "DONE" })).toMatch(/already/);
  });
  it("revisions run out only after the included ones are used", () => {
    expect(revisionsExceeded(2, 2)).toBe(false);
    expect(revisionsExceeded(3, 2)).toBe(true);
  });
  it("finds @mentions by first name or joined full name, and only real people", () => {
    const users = [{ id: "1", name: "Priya Kulkarni" }, { id: "2", name: "Rohan Patil" }, { id: "3", name: "Sneha More" }];
    expect(findMentions("@Priya please check with @rohanpatil.", users)).toEqual(["1", "2"]);
    expect(findMentions("email priya@x.in and @nobody", users)).toEqual([]);
  });
});

describe("retainers and onboarding", () => {
  it("works out the last day of a retainer", () => {
    expect(retainerEndKey("2026-11-03", 6)).toBe("2027-05-02");
    expect(retainerEndKey("2026-11-01", 1)).toBe("2026-11-30");
    expect(retainerEndKey("2026-08-31", 6)).toBe("2027-02-27");
    expect(retainerEndKey("2026-04-01", 12)).toBe("2027-03-31");
  });
  it("renews for the same length", () => {
    expect(renewedEnd("2026-01-01", "2026-01-31")).toBe("2026-03-03");
  });
  it("rounds onboarding to a whole percent, and zero items is zero", () => {
    expect(onboardingPercent(1, 3)).toBe(33);
    expect(onboardingPercent(0, 0)).toBe(0);
    expect(onboardingPercent(8, 8)).toBe(100);
  });
  it("repeats tasks per unit only for per-unit items, within a limit", () => {
    expect(unitSets("PER_UNIT", "4.00")).toBe(4);
    expect(unitSets("PER_UNIT", "0.50")).toBe(1);
    expect(unitSets("PER_UNIT", "5000")).toBe(100);
    expect(unitSets("MILESTONE", "4")).toBe(1);
  });
});

describe("validators", () => {
  const convert = { offerId: "o1", name: "Project", managerId: "", startDate: "2026-11-03", deadline: "", retainerEnd: "", autoRenew: false, milestones: [], targets: [], createTasks: true };
  it("checks the dates on a conversion", () => {
    expect(convertOfferSchema.safeParse(convert).success).toBe(true);
    expect(convertOfferSchema.safeParse({ ...convert, deadline: "2026-11-02" }).success).toBe(false);
    expect(convertOfferSchema.safeParse({ ...convert, retainerEnd: "2026-11-02" }).success).toBe(false);
    expect(convertOfferSchema.safeParse({ ...convert, startDate: "2026-02-30" }).success).toBe(false);
  });
  it("stops milestone payments going over 100%", () => {
    const ms = (p: string) => ({ name: "M", dueDate: "", paymentPercent: p });
    expect(convertOfferSchema.safeParse({ ...convert, milestones: [ms("50"), ms("30"), ms("20")] }).success).toBe(true);
    expect(convertOfferSchema.safeParse({ ...convert, milestones: [ms("50"), ms("51")] }).success).toBe(false);
    expect(convertOfferSchema.safeParse({ ...convert, milestones: [ms("101")] }).success).toBe(false);
  });
  it("lets a target value be blank, but not rubbish", () => {
    const t = (v: string) => ({ serviceId: "", metric: "Leads", unit: "", targetValue: v, higherIsBetter: true });
    expect(convertOfferSchema.safeParse({ ...convert, targets: [t("")] }).success).toBe(true);
    expect(convertOfferSchema.safeParse({ ...convert, targets: [t("1,200")] }).success).toBe(true);
    expect(convertOfferSchema.safeParse({ ...convert, targets: [t("lots")] }).success).toBe(false);
  });
  it("asks why when health is overridden", () => {
    const p = { name: "Project", managerId: "", status: "ACTIVE", startDate: "2026-11-03", deadline: "", retainerEnd: "", autoRenew: false, notes: "" };
    expect(projectSchema.safeParse({ ...p, healthOverride: "AT_RISK", healthOverrideNote: "" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, healthOverride: "AT_RISK", healthOverrideNote: "Client slow" }).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, healthOverride: "", healthOverrideNote: "" }).success).toBe(true);
  });
  it("a task needs a person or a department, and sensible dates", () => {
    const t = { title: "Do it", description: "", projectId: "", clientId: "", serviceId: "", milestoneId: "", priority: "MEDIUM", startDate: "", dueDate: "" };
    expect(taskSchema.safeParse({ ...t, assigneeId: "", departmentId: "" }).success).toBe(false);
    expect(taskSchema.safeParse({ ...t, assigneeId: "u1", departmentId: "" }).success).toBe(true);
    expect(taskSchema.safeParse({ ...t, assigneeId: "", departmentId: "d1", startDate: "2026-11-05", dueDate: "2026-11-04" }).success).toBe(false);
  });
  it("limits logged time to one day", () => {
    const l = { taskId: "t", date: "2026-11-03", note: "" };
    expect(timeLogSchema.safeParse({ ...l, minutes: 0 }).success).toBe(false);
    expect(timeLogSchema.safeParse({ ...l, minutes: 1441 }).success).toBe(false);
    expect(timeLogSchema.safeParse({ ...l, minutes: 90 }).success).toBe(true);
  });
  it("validates a team member's hourly cost and email", () => {
    const e = { name: "New Person", email: "NEW@Rezonest.com", role: "EMPLOYEE", phone: "", departmentId: "", designation: "", joiningDate: "", dailyDigest: false };
    const ok = employeeSchema.parse({ ...e, hourlyCost: "₹1,250" });
    expect(ok.email).toBe("new@rezonest.com");
    expect(ok.hourlyCost).toBe("1250");
    expect(employeeSchema.parse({ ...e, hourlyCost: "" }).hourlyCost).toBeNull();
    expect(employeeSchema.safeParse({ ...e, hourlyCost: "abc" }).success).toBe(false);
  });
  it("cleans up onboarding lines", () => {
    expect(onboardingLinesSchema.parse("Logo\r\n\n  Access  \nLogo\n")).toEqual(["Logo", "Access"]);
    expect(onboardingLinesSchema.safeParse(Array(41).fill(0).map((_, i) => `Item ${i}`).join("\n")).success).toBe(false);
  });
});
