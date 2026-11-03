import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook, INR_FMT } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { getOffersForExport } from "@/server/queries/offers";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("sales.manage");
    const rows = await getOffersForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Offers",
      [
        { header: "Number", key: "number", width: 22 },
        { header: "Version", key: "version", width: 9 },
        { header: "Title", key: "title", width: 44 },
        { header: "For", key: "recipient", width: 34 },
        { header: "Type", key: "recipientKind", width: 8 },
        { header: "Status", key: "status", width: 12 },
        { header: "Date", key: "offerDate", width: 13 },
        { header: "Valid until", key: "validUntil", width: 13 },
        { header: "Follow-up", key: "followUpDate", width: 13 },
        { header: "Value excl. GST (₹)", key: "taxableTotal", width: 18, numFmt: INR_FMT },
        { header: "Total incl. GST (₹)", key: "grandTotal", width: 18, numFmt: INR_FMT },
      ],
      rows.map((r) => ({
        ...r,
        status: statusDef("offer", r.status).label,
        offerDate: formatDateKey(r.offerDate),
        validUntil: formatDateKey(r.validUntil),
        followUpDate: r.followUpDate ? formatDateKey(r.followUpDate) : "",
        taxableTotal: Number(r.taxableTotal),
        grandTotal: Number(r.grandTotal),
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="offers-${todayKey()}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
