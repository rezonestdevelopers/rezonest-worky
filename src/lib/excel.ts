import "server-only";
import ExcelJS from "exceljs";
import { excelCell, type Cell, type ReportDoc } from "@/lib/reports";

export type ExcelColumn = { header: string; key: string; width?: number; numFmt?: string };

/** Build a branded .xlsx with a bold, frozen header row and filters. */
export async function buildWorkbook(sheetName: string, columns: ExcelColumn[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rezonest Work OS";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  ws.addRows(rows);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7202A" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const sheetName = (name: string, used: Set<string>) => {
  const base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet";
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} ${n}`;
  used.add(out.toLowerCase());
  return out;
};

function styleHeader(ws: ExcelJS.Worksheet, columns: number) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7202A" } };
  if (columns) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
}

/** Tables as stored, one sheet each. Used by the full data export. */
export async function buildMultiSheetWorkbook(sheets: { name: string; columns: string[]; rows: Record<string, unknown>[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rezonest Work OS";
  const used = new Set<string>();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.name, used), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
    ws.addRows(sheet.rows);
    styleHeader(ws, sheet.columns.length);
  }
  if (!sheets.length) wb.addWorksheet("Empty");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A report with a sheet per section. Money and counts are real numbers Excel can add up. */
export async function buildReportWorkbook(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rezonest Work OS";
  const used = new Set<string>();
  for (const section of doc.sections) {
    const ws = wb.addWorksheet(sheetName(section.title, used), { views: [{ state: "frozen", ySplit: 1 }] });
    const labels = section.columns.map((c, i) => c.label || `Text ${i + 1}`);
    ws.columns = section.columns.map((c, i) => ({ header: labels[i], key: `c${i}`, width: c.kind === "money" ? 15 : c.kind === "number" || c.kind === "percent" ? 11 : c.label ? 28 : 90, style: c.kind === "money" ? { numFmt: INR_FMT } : {} }));
    const toRow = (r: Cell[]) => Object.fromEntries(r.map((v, i) => [`c${i}`, excelCell(section.columns[i]?.kind, v)]));
    ws.addRows(section.rows.map(toRow));
    if (section.total) ws.addRow(toRow(section.total)).font = { bold: true };
    styleHeader(ws, section.columns.length);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Indian-grouped rupee format for Excel cells. */
export const INR_FMT = '[$₹-4009] #,##,##0.00';
