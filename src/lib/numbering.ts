import type { Prisma, SequenceType } from "@prisma/client";
import { financialYear } from "./dates";

/**
 * Document numbering: REZ/INV/2026-27/0001
 * Tokens in the format: {FY} = financial year, {SEQ} = zero-padded sequence.
 */
export function formatDocNumber(fmt: string, fy: string, seq: number, padding = 4): string {
  if (!fmt.includes("{SEQ}")) throw new Error("Number format must contain {SEQ}");
  return fmt.replaceAll("{FY}", fy).replaceAll("{SEQ}", String(seq).padStart(padding, "0"));
}

/**
 * Reserve the next sequence value for (type, financial year).
 *
 * MUST be called inside the same `prisma.$transaction` that saves the
 * document. The single UPSERT … RETURNING statement is atomic and takes a row
 * lock that is held until the transaction ends, so:
 *  - two people issuing at the same moment get different numbers;
 *  - if the transaction fails, the increment rolls back too, so numbers are
 *    never skipped and never reused.
 * The counter starts fresh for each financial year automatically.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  type: SequenceType,
  dateKey: string,
): Promise<{ fy: string; seq: number }> {
  const fy = financialYear(dateKey);
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "NumberSequence" ("id", "type", "financialYear", "lastValue", "updatedAt")
    VALUES (gen_random_uuid()::text, ${type}::"SequenceType", ${fy}, 1, now())
    ON CONFLICT ("type", "financialYear")
    DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;
  return { fy, seq: Number(rows[0].lastValue) };
}

const FORMAT_FIELD: Record<SequenceType, "quotationFormat" | "proformaFormat" | "invoiceFormat" | "creditNoteFormat"> = {
  QUOTATION: "quotationFormat",
  PROFORMA: "proformaFormat",
  INVOICE: "invoiceFormat",
  CREDIT_NOTE: "creditNoteFormat",
};

/** Reserve and format the next document number using the formats in Settings. */
export async function nextDocNumber(
  tx: Prisma.TransactionClient,
  type: SequenceType,
  dateKey: string,
): Promise<string> {
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  const { fy, seq } = await nextSequence(tx, type, dateKey);
  return formatDocNumber(settings[FORMAT_FIELD[type]], fy, seq, settings.seqPadding);
}
