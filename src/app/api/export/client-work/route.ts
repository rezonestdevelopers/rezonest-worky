import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { buildWorkbook, INR_FMT, type ExcelColumn } from "@/lib/excel";
import { formatDateKey, todayKey } from "@/lib/dates";
import { statusDef } from "@/lib/status";
import { buildScope, parseFilters } from "@/server/queries/dashboard/filters";
import { getClientWork } from "@/server/queries/dashboard/data";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("dashboard.full");
    const filters = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
    const rows = await getClientWork(await buildScope(filters));
    const money = can(user.role, "dashboard.full");

    const columns: ExcelColumn[] = [
      { header: "Client", key: "client", width: 34 },
      { header: "Sector", key: "sector", width: 28 },
      { header: "Services", key: "services", width: 40 },
      { header: "Active project", key: "activeProject", width: 38 },
      { header: "Target", key: "target", width: 26 },
      { header: "Deadline", key: "deadline", width: 14 },
      { header: "Progress %", key: "progress", width: 11 },
      { header: "Health", key: "health", width: 12 },
      { header: "Assigned team", key: "team", width: 30 },
      ...(money
        ? [
            { header: "Payment status", key: "paymentStatus", width: 16 },
            { header: "Outstanding (₹)", key: "outstanding", width: 16, numFmt: INR_FMT },
          ]
        : []),
      { header: "Next action", key: "nextAction", width: 40 },
      { header: "Next action date", key: "nextActionDate", width: 16 },
    ];
    const data = rows.map((r) => ({
      ...r,
      services: r.services.join(", "),
      deadline: formatDateKey(r.deadline),
      health: r.health ? statusDef("health", r.health).label : "",
      team: r.team.join(", "),
      paymentStatus: statusDef("payment", r.paymentStatus).label,
      nextActionDate: r.nextActionDate ? formatDateKey(r.nextActionDate) : "",
    }));
    const buf = await buildWorkbook("Client work", columns, data);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="client-work-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
