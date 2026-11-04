import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { daysBetweenKeys, formatDateKey, todayKey } from "@/lib/dates";
import { buildWorkbook } from "@/lib/excel";
import { assetKindLabel } from "@/lib/renewals";
import { getRenewalsForExport } from "@/server/queries/renewals";

export async function GET(req: NextRequest) {
  try {
    await assertPermission("finance.manage");
    const rows = await getRenewalsForExport(Object.fromEntries(req.nextUrl.searchParams));
    const today = todayKey();
    const buffer = await buildWorkbook(
      "Renewals",
      [
        { header: "Item", key: "name", width: 34 },
        { header: "Type", key: "kind", width: 15 },
        { header: "Client", key: "client", width: 34 },
        { header: "Provider", key: "provider", width: 20 },
        { header: "Plan", key: "plan", width: 18 },
        { header: "Expires", key: "expiryDate", width: 13 },
        { header: "Days left", key: "daysLeft", width: 10 },
        { header: "Auto-renew", key: "autoRenew", width: 11 },
        { header: "Our cost (₹)", key: "cost", width: 12 },
        { header: "Renewal price (₹)", key: "price", width: 16 },
        { header: "Margin (₹)", key: "margin", width: 11 },
      ],
      rows.map((r) => ({
        ...r,
        kind: assetKindLabel(r.kind),
        provider: r.provider ?? "",
        plan: r.plan ?? "",
        daysLeft: daysBetweenKeys(today, r.expiryDate),
        expiryDate: formatDateKey(r.expiryDate),
        autoRenew: r.autoRenew ? "Yes" : "No",
        cost: Number(r.cost),
        price: Number(r.price),
        margin: Number(r.margin),
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="renewals-${today}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
