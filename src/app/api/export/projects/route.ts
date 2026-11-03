import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getProjectsForExport } from "@/server/queries/projects";
import { loadViewer } from "@/server/services/tasks";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("work.own");
    const rows = await getProjectsForExport(Object.fromEntries(req.nextUrl.searchParams), await loadViewer(db, user));
    const buffer = await buildWorkbook(
      "Projects",
      [
        { header: "Code", key: "code", width: 11 },
        { header: "Project", key: "name", width: 42 },
        { header: "Client", key: "client", width: 34 },
        { header: "Type", key: "type", width: 10 },
        { header: "Status", key: "status", width: 13 },
        { header: "Health", key: "health", width: 11 },
        { header: "Progress %", key: "progress", width: 11 },
        { header: "Start", key: "startDate", width: 13 },
        { header: "Deadline / ends", key: "deadline", width: 15 },
        { header: "Manager", key: "manager", width: 22 },
        { header: "Open tasks", key: "openTasks", width: 11 },
      ],
      rows.map((r) => ({
        ...r,
        status: statusDef("project", r.status).label,
        health: statusDef("health", r.health).label,
        startDate: formatDateKey(r.startDate),
        deadline: r.deadline ? formatDateKey(r.deadline) : "",
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="projects-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
