import { describe, expect, it } from "vitest";
import { amountInWords, integerToIndianWords } from "@/lib/money/words";
import { formatINR, formatINRCompact } from "@/lib/money/format";

describe("amountInWords (Indian system)", () => {
  it.each([
    [0, "Rupees Zero Only"],
    [1, "Rupees One Only"],
    [25, "Rupees Twenty-Five Only"],
    [100, "Rupees One Hundred Only"],
    [999, "Rupees Nine Hundred Ninety-Nine Only"],
    [1000, "Rupees One Thousand Only"],
    [125000, "Rupees One Lakh Twenty-Five Thousand Only"],
    [1000000, "Rupees Ten Lakh Only"],
    [10000000, "Rupees One Crore Only"],
    [12345678, "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only"],
    [1000000000, "Rupees One Hundred Crore Only"],
  ])("%s → %s", (n, words) => {
    expect(amountInWords(n)).toBe(words);
  });

  it("includes paise", () => {
    expect(amountInWords("29500.50")).toBe("Rupees Twenty-Nine Thousand Five Hundred and Fifty Paise Only");
    expect(amountInWords("10.05")).toBe("Rupees Ten and Five Paise Only");
  });

  it("integerToIndianWords handles 1,01,01,101", () => {
    expect(integerToIndianWords(10101101)).toBe("One Crore One Lakh One Thousand One Hundred One");
  });

  it("rejects negatives", () => {
    expect(() => amountInWords(-1)).toThrow();
  });
});

describe("formatINR", () => {
  it("uses Indian grouping", () => {
    expect(formatINR("125000")).toBe("₹1,25,000.00");
    expect(formatINR("12345678.9")).toBe("₹1,23,45,678.90");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR("125000", { decimals: false })).toBe("₹1,25,000");
  });
  it("compact form", () => {
    expect(formatINRCompact(950)).toBe("₹950");
    expect(formatINRCompact(12500)).toBe("₹12.5K");
    expect(formatINRCompact(125000)).toBe("₹1.25L");
    expect(formatINRCompact(24000000)).toBe("₹2.4Cr");
    expect(formatINRCompact(200000)).toBe("₹2L");
  });
});
