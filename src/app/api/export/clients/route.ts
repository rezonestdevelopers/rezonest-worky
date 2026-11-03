import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { buildWorkbook, INR_FMT, type ExcelColumn } from "@/lib/excel";
import { can } from "@/lib/permissions";
import { statusDef } from "@/lib/status";
import { getClientsForExport } from "@/server/queries/clients";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("sales.manage");
    const showMoney = can(user.role, "finance.manage");
    const rows = await getClientsForExport(Object.fromEntries(req.nextUrl.searchParams), showMoney);
    const columns: ExcelColumn[] = [
      { header: "Client", key: "companyName", width: 36 },
      { header: "Contact", key: "contact", width: 24 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Email", key: "email", width: 30 },
      { header: "Sector", key: "sector", width: 28 },
      { header: "City", key: "city", width: 16 },
      { header: "State", key: "state", width: 16 },
      { header: "GSTIN", key: "gstin", width: 18 },
      { header: "Lead source", key: "source", width: 14 },
      { header: "Account manager", key: "manager", width: 20 },
      { header: "Tags", key: "tags", width: 24 },
      { header: "Active projects", key: "activeProjects", width: 14 },
      ...(showMoney ? [{ header: "Outstanding (₹)", key: "outstanding", width: 16, numFmt: INR_FMT }] : []),
      { header: "Status", key: "status", width: 12 },
    ];
    const buffer = await buildWorkbook(
      "Clients",
      columns,
      rows.map((r) => ({
        ...r,
        tags: r.tags.join(", "),
        status: statusDef("client", r.status).label,
        outstanding: r.outstanding === null ? null : Number(r.outstanding),
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="clients-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
