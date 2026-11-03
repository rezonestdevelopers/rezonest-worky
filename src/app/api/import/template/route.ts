import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { fieldsFor } from "@/lib/import/analyse";

/** Blank import template. The example row sits on a second sheet, so it can't be imported by accident. */
export async function GET(req: NextRequest) {
  try {
    await assertPermission("sales.manage");
    const kind = req.nextUrl.searchParams.get("kind") === "clients" ? "clients" : "leads";
    const fields = fieldsFor(kind);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Rezonest Work OS";
    const sheet = wb.addWorksheet(kind === "leads" ? "Leads" : "Clients", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = fields.map((f) => ({ header: f.label, key: f.key, width: Math.max(16, f.label.length + 4) }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7202A" } };

    const example = wb.addWorksheet("Example (not imported)");
    example.columns = fields.map((f) => ({ header: f.label, key: f.key, width: Math.max(16, f.example.length + 2) }));
    example.getRow(1).font = { bold: true };
    example.addRow(Object.fromEntries(fields.map((f) => [f.key, f.example])));

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rezonest-${kind}-import-template.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
