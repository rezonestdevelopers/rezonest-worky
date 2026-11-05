import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { expenseCategoryLabel } from "@/lib/profit";
import { getExpensesForExport } from "@/server/queries/expenses";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("finance.manage");
    const rows = await getExpensesForExport(Object.fromEntries(req.nextUrl.searchParams));
    const buffer = await buildWorkbook(
      "Expenses",
      [
        { header: "Date", key: "date", width: 13 },
        { header: "Category", key: "category", width: 22 },
        { header: "Description", key: "description", width: 40 },
        { header: "Paid to", key: "vendor", width: 24 },
        { header: "Client", key: "client", width: 30 },
        { header: "Project", key: "project", width: 30 },
        { header: "Amount before GST (₹)", key: "amount", width: 15 },
        { header: "GST paid (₹)", key: "gstPaid", width: 12 },
        { header: "Bill attached", key: "bill", width: 12 },
      ],
      rows.map((r) => ({ ...r, date: formatDateKey(r.date), category: expenseCategoryLabel(r.category), vendor: r.vendor ?? "", client: r.client ?? "", project: r.project ?? "", amount: Number(r.amount), gstPaid: Number(r.gstPaid), bill: r.hasBill ? "Yes" : "" })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="expenses-${todayKey()}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
