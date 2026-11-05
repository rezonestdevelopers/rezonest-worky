import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { periodRange } from "@/lib/profit";
import { getNames } from "@/server/queries/expenses";
import { profitReport } from "@/server/services/profit";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("finance.manage");
    const today = todayKey();
    const period = periodRange(req.nextUrl.searchParams.get("period"), today);
    const report = await profitReport(db, period.from, period.to);
    const names = await getNames(report.clients.map((c) => c.id), report.projects.map((p) => p.id));
    const row = (kind: string, name: string, client: string, r: (typeof report.clients)[number]) => ({ kind, name, client, revenue: r.revenue.toNumber(), expenses: r.expenses.toNumber(), time: r.time.toNumber(), profit: r.profit.toNumber(), margin: r.marginPercent ?? "" });
    const buffer = await buildWorkbook(
      "Profitability",
      [
        { header: "For", key: "kind", width: 9 },
        { header: "Name", key: "name", width: 36 },
        { header: "Client", key: "client", width: 34 },
        { header: "Revenue before GST (₹)", key: "revenue", width: 16 },
        { header: "Expenses (₹)", key: "expenses", width: 13 },
        { header: "Team time (₹)", key: "time", width: 13 },
        { header: "Profit (₹)", key: "profit", width: 13 },
        { header: "Margin %", key: "margin", width: 9 },
      ],
      [
        ...report.clients.map((c) => row("Client", names.clients.get(c.id) ?? "", "", c)),
        ...report.projects.map((p) => row("Project", names.projects.get(p.id)?.name ?? "", names.projects.get(p.id)?.client ?? "", p)),
      ],
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="profit-${period.key}-${today}.xlsx"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
