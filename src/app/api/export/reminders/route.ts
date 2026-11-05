import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getRemindersForExport } from "@/server/queries/reminders";
import { loadViewer } from "@/server/services/tasks";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("work.own");
    const rows = await getRemindersForExport(Object.fromEntries(req.nextUrl.searchParams), await loadViewer(db, user));
    const buffer = await buildWorkbook(
      "Reminders",
      [
        { header: "Urgency", key: "severity", width: 11 },
        { header: "Reminder", key: "title", width: 56 },
        { header: "Details", key: "detail", width: 56 },
        { header: "Type", key: "category", width: 20 },
        { header: "Date", key: "dueDate", width: 13 },
      ],
      rows.map((r) => ({ ...r, severity: statusDef("severity", r.severity).label, detail: r.detail ?? "", dueDate: r.dueDate ? formatDateKey(r.dueDate) : "" })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reminders-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
