import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { nextDocNumber, nextSequence } from "@/lib/numbering";

const db = new PrismaClient();
// This file and phase2.test.ts share one test database, so they run one after the other (see vitest.config.ts).

beforeEach(async () => {
  await db.numberSequence.deleteMany();
  await db.settings.upsert({
    where: { id: "agency" },
    update: {},
    create: { id: "agency", agencyName: "Test Agency", address: "Pune" },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("invoice numbering (real PostgreSQL)", () => {
  it("starts at 0001 and increments", async () => {
    const a = await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2026-11-02"));
    const b = await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2026-11-03"));
    expect(a).toBe("REZ/INV/2026-27/0001");
    expect(b).toBe("REZ/INV/2026-27/0002");
  });

  it("each document type has its own series", async () => {
    await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2026-11-02"));
    const pi = await db.$transaction((tx) => nextDocNumber(tx, "PROFORMA", "2026-11-02"));
    const qt = await db.$transaction((tx) => nextDocNumber(tx, "QUOTATION", "2026-11-02"));
    const cn = await db.$transaction((tx) => nextDocNumber(tx, "CREDIT_NOTE", "2026-11-02"));
    expect(pi).toBe("REZ/PI/2026-27/0001");
    expect(qt).toBe("REZ/QT/2026-27/0001");
    expect(cn).toBe("REZ/CN/2026-27/0001");
  });

  it("resets every financial year (1 April)", async () => {
    await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2027-03-31"));
    await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2027-03-31"));
    const april = await db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2027-04-01"));
    expect(april).toBe("REZ/INV/2027-28/0001");
  });

  it("a failed transaction does not consume a number (no gaps, no reuse)", async () => {
    await db.$transaction((tx) => nextSequence(tx, "INVOICE", "2026-11-02"));
    await expect(
      db.$transaction(async (tx) => {
        await nextSequence(tx, "INVOICE", "2026-11-02");
        throw new Error("simulated failure while saving the invoice");
      }),
    ).rejects.toThrow("simulated failure");
    const next = await db.$transaction((tx) => nextSequence(tx, "INVOICE", "2026-11-02"));
    expect(next.seq).toBe(2);
  });

  it("25 concurrent issues get 25 unique, consecutive numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => db.$transaction((tx) => nextDocNumber(tx, "INVOICE", "2026-11-02"))),
    );
    const unique = new Set(results);
    expect(unique.size).toBe(25);
    const seqs = results.map((r) => Number(r.split("/").pop())).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
