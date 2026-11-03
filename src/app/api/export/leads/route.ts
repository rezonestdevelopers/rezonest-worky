import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, istDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook, INR_FMT } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getLeadsForExport } from "@/server/queries/leads";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("sales.manage");
    const rows = await getLeadsForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Leads",
      [
        { header: "Contact", key: "contactName", width: 26 },
        { header: "Company", key: "companyName", width: 32 },
        { header: "Phone", key: "phone", width: 18 },
        { header: "WhatsApp", key: "whatsapp", width: 18 },
        { header: "Email", key: "email", width: 30 },
        { header: "City", key: "city", width: 16 },
        { header: "Sector", key: "sector", width: 28 },
        { header: "Lead source", key: "source", width: 14 },
        { header: "Stage", key: "stage", width: 22 },
        { header: "Lost reason", key: "lostReason", width: 30 },
        { header: "Budget (₹)", key: "approxBudget", width: 14, numFmt: INR_FMT },
        { header: "Next follow-up", key: "nextFollowUpDate", width: 15 },
        { header: "Owner", key: "owner", width: 20 },
        { header: "Requirement notes", key: "requirementNotes", width: 50 },
        { header: "Created", key: "createdAt", width: 14 },
      ],
      rows.map((r) => ({
        ...r,
        stage: statusDef("lead", r.stage).label,
        approxBudget: r.approxBudget === null ? null : Number(r.approxBudget),
        nextFollowUpDate: r.nextFollowUpDate ? formatDateKey(r.nextFollowUpDate) : "",
        createdAt: formatDateKey(istDateKey(new Date(r.createdAt))),
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leads-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
