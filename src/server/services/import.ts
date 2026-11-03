import ExcelJS from "exceljs";
import {
  analyseClientRow,
  analyseLeadRow,
  analyseRows,
  fieldsFor,
  mapHeaders,
  type ImportKind,
  type ImportRefs,
  type RawRow,
} from "@/lib/import/analyse";
import { parseCsv } from "@/lib/import/csv";
import { createClientInTx } from "./clients";
import { createLeadInTx } from "./leads";
import { BusinessError, loadContactables, logActivity, type Db } from "./shared";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Turns any Excel cell into plain text. Email cells often arrive as links, and dates as Date objects. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const v = value as { text?: unknown; richText?: { text: string }[]; result?: unknown; hyperlink?: string };
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v.text !== undefined) return cellToText(v.text);
    if (v.result !== undefined) return cellToText(v.result);
    if (v.hyperlink) return v.hyperlink.replace(/^mailto:/i, "").trim();
  }
  return "";
}

/** Reads the first sheet of an .xlsx file, or a .csv file, into rows of text. */
async function readTable(buffer: Buffer, fileName: string): Promise<{ number: number; cells: string[] }[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    if (buffer.includes(0)) throw new BusinessError("This doesn't look like a CSV file.");
    return parseCsv(buffer.toString("utf8")).map((cells, i) => ({ number: i + 1, cells: cells.map((c) => c.trim()) }));
  }
  if (lower.endsWith(".xls")) throw new BusinessError("Old .xls files aren't supported. In Excel, use Save As → .xlsx and try again.");
  if (!lower.endsWith(".xlsx") || buffer.subarray(0, 2).toString() !== "PK") {
    throw new BusinessError("Please upload an Excel (.xlsx) or CSV file.");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BusinessError("This Excel file couldn't be read. It may be damaged or password protected.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: { number: number; cells: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellToText(row.getCell(c).value));
    rows.push({ number, cells });
  });
  return rows;
}

export async function parseImportFile(kind: ImportKind, buffer: Buffer, fileName: string) {
  const table = (await readTable(buffer, fileName)).filter((r) => r.cells.some(Boolean));
  if (table.length === 0) throw new BusinessError("This file is empty.");
  const [header, ...body] = table;
  const { mapping, ignored } = mapHeaders(header.cells, fieldsFor(kind));

  const required = kind === "leads" ? "contactName" : "companyName";
  if (!Object.values(mapping).includes(required)) {
    const label = fieldsFor(kind).find((f) => f.key === required)?.label;
    throw new BusinessError(`No “${label}” column was found in the first row. Download the template to see the expected columns.`);
  }
  if (body.length === 0) throw new BusinessError("The file has column headings but no rows of data.");
  if (body.length > MAX_IMPORT_ROWS) throw new BusinessError(`This file has ${body.length} rows. The limit is ${MAX_IMPORT_ROWS} at a time, so please split it.`);

  const rows: RawRow[] = body.map((r) => {
    const values: Record<string, string> = {};
    for (const [index, key] of Object.entries(mapping)) values[key] = r.cells[Number(index)] ?? "";
    return { rowNumber: r.number, values };
  });
  return { rows, ignoredColumns: ignored };
}

async function loadRefs(db: Db): Promise<ImportRefs> {
  const [sectors, sources, services] = await Promise.all([
    db.sector.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.leadSource.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.service.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  return { sectors, sources, services };
}

export async function analyseImport(db: Db, kind: ImportKind, rows: RawRow[]) {
  const refs = await loadRefs(db);
  if (kind === "leads") {
    const existing = await loadContactables(db, { leads: true });
    return analyseRows(rows, (r) => analyseLeadRow(r, refs), existing);
  }
  const existing = await loadContactables(db, { leads: false });
  return analyseRows(rows, (r) => analyseClientRow(r, refs), existing);
}

/**
 * Saves the approved rows. Everything is checked again here, because the browser can't be
 * trusted and data may have changed since the preview. Rows with errors are skipped, and so
 * are duplicates unless you ticked "import anyway". It's all-or-nothing: if anything fails,
 * nothing is saved.
 */
export async function commitImport(db: Db, input: { kind: ImportKind; rows: RawRow[]; allowDuplicateRows: number[]; actorId: string }) {
  const { kind, rows, actorId } = input;
  const allow = new Set(input.allowDuplicateRows);
  const analysed = await analyseImport(db, kind, rows);

  let created = 0;
  let skippedDuplicates = 0;
  let skippedErrors = 0;

  await db.$transaction(
    async (tx) => {
      for (const row of analysed) {
        if (!row.data) {
          skippedErrors++;
          continue;
        }
        if (row.duplicates.length && !allow.has(row.rowNumber)) {
          skippedDuplicates++;
          continue;
        }
        if (kind === "leads") await createLeadInTx(tx, row.data as Parameters<typeof createLeadInTx>[1], actorId, "lead.imported");
        else await createClientInTx(tx, row.data as Parameters<typeof createClientInTx>[1], actorId, "client.imported");
        created++;
      }
      await logActivity(tx, {
        actorId, action: `import.${kind}`, entityType: "Import", entityId: kind,
        changes: { rows: rows.length, created, skippedDuplicates, skippedErrors },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { created, skippedDuplicates, skippedErrors };
}
