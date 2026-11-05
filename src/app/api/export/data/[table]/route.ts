import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { columnsOf, toCsv } from "@/lib/csv";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildMultiSheetWorkbook } from "@/lib/excel";
import { EXPORT_TABLES, exportRows, exportTable } from "@/server/services/data-export";
import { logActivity } from "@/server/services/shared";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** One table as CSV or Excel, or "all" as one Excel file with a sheet per table. Every download is logged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  try {
    const user = await assertPermission("settings.manage");
    const key = (await params).table;
    const csv = req.nextUrl.searchParams.get("format") === "csv";
    const today = todayKey();
    if (key === "all") {
      const sheets = [];
      for (const t of EXPORT_TABLES) {
        const rows = (await exportRows(db, t.key)) ?? [];
        sheets.push({ name: t.label, columns: columnsOf(rows), rows });
      }
      const buffer = await buildMultiSheetWorkbook(sheets);
      await logActivity(db, { actorId: user.id, action: "data.exported", entityType: "Data", entityId: "all", changes: { table: "all" } });
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="rezonest-all-data-${today}.xlsx"`, "Cache-Control": "no-store" } });
    }
    const table = exportTable(key);
    if (!table) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = (await exportRows(db, key)) ?? [];
    const columns = columnsOf(rows);
    await logActivity(db, { actorId: user.id, action: "data.exported", entityType: "Data", entityId: key, changes: { table: key, format: csv ? "csv" : "xlsx", rows: rows.length } });
    if (csv) {
      return new NextResponse(toCsv(columns, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key}-${today}.csv"`, "Cache-Control": "no-store" } });
    }
    const buffer = await buildMultiSheetWorkbook([{ name: table.label, columns, rows }]);
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${key}-${today}.xlsx"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
