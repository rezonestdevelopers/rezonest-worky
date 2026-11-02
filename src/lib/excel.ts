import "server-only";
import ExcelJS from "exceljs";

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

/** Indian-grouped rupee format for Excel cells. */
export const INR_FMT = '[$₹-4009] #,##,##0.00';
