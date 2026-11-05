import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { buildReportWorkbook } from "@/lib/excel";
import { renderReportPdf } from "@/lib/pdf/report-pdf";
import { agencyLetterhead, loadReport } from "@/server/report-loader";
import { BusinessError } from "@/server/services/shared";

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = (await params).kind;
    // The client's monthly report has no fees, costs or team names. Everything else needs finance access.
    await assertPermission(kind === "monthly" ? "reports.monthly" : "finance.manage");
    const doc = await loadReport(kind, Object.fromEntries(req.nextUrl.searchParams));
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (req.nextUrl.searchParams.get("format") === "xlsx") {
      const buffer = await buildReportWorkbook(doc);
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${doc.fileName}.xlsx"`, "Cache-Control": "no-store" } });
    }
    const pdf = await renderReportPdf(doc, await agencyLetterhead());
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${doc.fileName}.pdf"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
