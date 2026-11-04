import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getCampaignsForExport } from "@/server/queries/ads";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("work.manage");
    const rows = await getCampaignsForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Campaigns",
      [
        { header: "Campaign", key: "name", width: 38 },
        { header: "Client", key: "client", width: 34 },
        { header: "Objective", key: "objective", width: 14 },
        { header: "Status", key: "status", width: 11 },
        { header: "Start", key: "startDate", width: 13 },
        { header: "End", key: "endDate", width: 13 },
        { header: "Client's budget (₹)", key: "budget", width: 17 },
        { header: "Spent (₹)", key: "spend", width: 13 },
        { header: "Budget used %", key: "utilisation", width: 13 },
        { header: "Impressions", key: "impressions", width: 12 },
        { header: "Clicks", key: "clicks", width: 9 },
        { header: "CTR %", key: "ctr", width: 8 },
        { header: "Leads", key: "leads", width: 8 },
        { header: "CPL (₹)", key: "cpl", width: 10 },
        { header: "ROAS", key: "roas", width: 8 },
      ],
      rows.map((r) => ({
        ...r,
        objective: r.objective ?? "",
        status: statusDef("campaign", r.status).label,
        startDate: formatDateKey(r.startDate),
        endDate: r.endDate ? formatDateKey(r.endDate) : "",
        budget: Number(r.budget),
        spend: Number(r.spend),
        cpl: r.cpl === null ? "" : Number(r.cpl),
        utilisation: r.utilisation ?? "",
        ctr: r.ctr ?? "",
        roas: r.roas ?? "",
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ad-campaigns-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
