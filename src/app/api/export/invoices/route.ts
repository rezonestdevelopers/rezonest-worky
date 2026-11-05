import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { humanize } from "@/lib/status";
import { getInvoicesForExport } from "@/server/queries/invoices";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("finance.manage");
    const rows = await getInvoicesForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Invoices",
      [
        { header: "Number", key: "number", width: 24 },
        { header: "Client", key: "client", width: 34 },
        { header: "Type", key: "type", width: 12 },
        { header: "Status", key: "status", width: 12 },
        { header: "Payment", key: "paymentStatus", width: 15 },
        { header: "Date", key: "invoiceDate", width: 13 },
        { header: "Due", key: "dueDate", width: 13 },
        { header: "Total (₹)", key: "total", width: 13 },
        { header: "Balance (₹)", key: "balance", width: 13 },
      ],
      rows.map((r) => ({ ...r, number: r.number ?? "Draft", type: humanize(r.type), status: humanize(r.status), paymentStatus: r.type === "TAX" && r.status === "ISSUED" ? humanize(r.paymentStatus) : "", invoiceDate: formatDateKey(r.invoiceDate), dueDate: formatDateKey(r.dueDate), total: Number(r.total), balance: Number(r.balance) })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="invoices-${todayKey()}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
