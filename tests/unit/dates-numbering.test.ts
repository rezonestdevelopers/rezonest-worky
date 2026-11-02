import { describe, expect, it } from "vitest";
import {
  addDaysKey,
  daysBetweenKeys,
  financialYear,
  formatDateKey,
  formatDateTime,
  istDateKey,
  monthRange,
  shiftMonth,
} from "@/lib/dates";
import { formatDocNumber } from "@/lib/numbering";

describe("financialYear (April–March)", () => {
  it.each([
    ["2026-04-01", "2026-27"],
    ["2026-11-02", "2026-27"],
    ["2027-03-31", "2026-27"],
    ["2027-04-01", "2027-28"],
    ["2099-12-31", "2099-00"],
    ["2000-01-15", "1999-00"],
  ])("%s → %s", (k, fy) => expect(financialYear(k)).toBe(fy));
});

describe("IST dates", () => {
  it("UTC 20:00 on 31 Mar is already 1 Apr in IST", () => {
    expect(istDateKey(new Date("2027-03-31T20:00:00Z"))).toBe("2027-04-01");
    expect(financialYear(istDateKey(new Date("2027-03-31T20:00:00Z")))).toBe("2027-28");
  });
  it("formats DD MMM YYYY", () => {
    expect(formatDateKey("2026-11-02")).toBe("02 Nov 2026");
    expect(formatDateKey(new Date("2026-01-09T00:00:00Z"))).toBe("09 Jan 2026");
  });
  it("formats timestamps in IST", () => {
    expect(formatDateTime(new Date("2026-11-02T03:35:00Z"))).toBe("02 Nov 2026, 09:05 AM");
  });
  it("date arithmetic", () => {
    expect(addDaysKey("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetweenKeys("2026-11-02", "2026-12-02")).toBe(30);
    expect(monthRange("2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
  });
});

describe("formatDocNumber", () => {
  it("builds REZ/INV/2026-27/0001", () => {
    expect(formatDocNumber("REZ/INV/{FY}/{SEQ}", "2026-27", 1)).toBe("REZ/INV/2026-27/0001");
    expect(formatDocNumber("REZ/QT/{FY}/{SEQ}", "2026-27", 12345)).toBe("REZ/QT/2026-27/12345");
    expect(formatDocNumber("INV-{SEQ}", "2026-27", 7, 3)).toBe("INV-007");
  });
  it("requires {SEQ}", () => {
    expect(() => formatDocNumber("REZ/INV/{FY}", "2026-27", 1)).toThrow();
  });
});
