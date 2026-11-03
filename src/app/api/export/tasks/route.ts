import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getTasksForExport } from "@/server/queries/tasks";
import { loadViewer } from "@/server/services/tasks";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("work.own");
    const rows = await getTasksForExport(Object.fromEntries(req.nextUrl.searchParams), await loadViewer(db, user));
    const buffer = await buildWorkbook(
      "Tasks",
      [
        { header: "Task", key: "title", width: 50 },
        { header: "Status", key: "status", width: 20 },
        { header: "Priority", key: "priority", width: 10 },
        { header: "Due", key: "dueDate", width: 13 },
        { header: "Assigned to", key: "assignee", width: 22 },
        { header: "Department", key: "department", width: 28 },
        { header: "Client", key: "client", width: 32 },
        { header: "Project", key: "project", width: 36 },
      ],
      rows.map((r) => ({ ...r, status: statusDef("task", r.status).label, priority: statusDef("priority", r.priority).label, dueDate: r.dueDate ? formatDateKey(r.dueDate) : "" })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tasks-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
