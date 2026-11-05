"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import type { DuplicateMatch } from "@/lib/contact-match";
import { runAction } from "@/server/action-guard";
import type { ActionResult } from "@/lib/action-result";
import { analyseImport, commitImport, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseImportFile } from "@/server/services/import";
import { BusinessError } from "@/server/services/shared";

const kindSchema = z.enum(["leads", "clients"]);

export type PreviewRow = {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  duplicates: DuplicateMatch[];
};
export type PreviewResult = { ok: true; rows: PreviewRow[]; ignoredColumns: string[] } | { ok: false; error: string };

/** Step 1: read the file and report what would happen. Nothing is saved. */
export async function previewImportAction(formData: FormData): Promise<PreviewResult> {
  try {
    await assertPermission("sales.manage");
    const kind = kindSchema.parse(formData.get("kind"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a file." };
    if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "The file must be 5 MB or smaller." };

    const { rows, ignoredColumns } = await parseImportFile(kind, Buffer.from(await file.arrayBuffer()), file.name);
    const analysed = await analyseImport(db, kind, rows);
    return {
      ok: true,
      ignoredColumns,
      rows: analysed.map((r) => ({ rowNumber: r.rowNumber, values: r.values, errors: r.errors, warnings: r.warnings, duplicates: r.duplicates })),
    };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "This file couldn't be read. Please check it and try again." };
  }
}

const commitSchema = z.object({
  kind: kindSchema,
  rows: z
    .array(z.object({ rowNumber: z.number().int().positive(), values: z.record(z.string(), z.string().max(5000)) }))
    .min(1)
    .max(MAX_IMPORT_ROWS),
  allowDuplicateRows: z.array(z.number().int()).max(MAX_IMPORT_ROWS),
});

/** Step 2: save the rows you approved. Every row is validated again on the server. */
export async function commitImportAction(input: z.input<typeof commitSchema>): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = commitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "The import data wasn't valid. Please upload the file again." };
    const result = await commitImport(db, { ...parsed.data, actorId: user.id });
    revalidatePath(`/${parsed.data.kind}`);
    revalidatePath("/dashboard");
    const skipped = [
      result.skippedDuplicates ? `${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? "" : "s"} skipped` : "",
      result.skippedErrors ? `${result.skippedErrors} row${result.skippedErrors === 1 ? "" : "s"} with errors skipped` : "",
    ].filter(Boolean);
    return { ok: true, message: `${result.created} imported${skipped.length ? `, ${skipped.join(", ")}` : ""}.` };
  });
}
