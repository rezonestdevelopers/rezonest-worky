import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { paymentModeLabel } from "@/lib/invoice-rules";
import { getPaymentsForExport } from "@/server/queries/invoices";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("finance.manage");
    const rows = await getPaymentsForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Payments",
      [
        { header: "Date", key: "date", width: 13 },
        { header: "Client", key: "client", width: 34 },
        { header: "Amount (₹)", key: "amount", width: 13 },
        { header: "TDS (₹)", key: "tds", width: 11 },
        { header: "TDS section", key: "tdsSection", width: 11 },
        { header: "Mode", key: "mode", width: 15 },
        { header: "Reference", key: "reference", width: 22 },
        { header: "Invoices", key: "invoices", width: 40 },
        { header: "Advance left (₹)", key: "advance", width: 14 },
        { header: "Void", key: "voided", width: 7 },
      ],
      rows.map((r) => ({ ...r, date: formatDateKey(r.date), amount: Number(r.amount), tds: Number(r.tds), tdsSection: r.tdsSection ?? "", mode: paymentModeLabel(r.mode), reference: r.reference ?? "", advance: r.voided ? 0 : Number(r.advance), voided: r.voided ? "Yes" : "" })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="payments-${todayKey()}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
