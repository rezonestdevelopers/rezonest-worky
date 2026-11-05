import { NextResponse } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { AGEING_BUCKETS, AGEING_LABEL } from "@/lib/invoice-rules";
import { getAgeingReport } from "@/server/queries/invoices";

export async function GET() {
  try {
    await assertPermission("finance.manage");
    const { rows } = await getAgeingReport();
    const buffer = await buildWorkbook(
      "Ageing",
      [
        { header: "Client", key: "client", width: 34 },
        ...AGEING_BUCKETS.map((b) => ({ header: `${AGEING_LABEL[b]} (₹)`, key: b, width: 15 })),
        { header: "Total (₹)", key: "total", width: 13 },
        { header: "Advance (₹)", key: "advance", width: 13 },
      ],
      rows.map((r) => ({ client: r.client, ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, r.buckets[b].toNumber()])), total: r.total.toNumber(), advance: r.advance.toNumber() })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ageing-${todayKey()}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
