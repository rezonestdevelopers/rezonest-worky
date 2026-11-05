import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { statementPeriod } from "@/lib/invoice-rules";
import { renderStatementPdf } from "@/lib/pdf/invoice-pdf";
import { clientLedger } from "@/server/services/payments";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPermission("finance.manage");
    const { id } = await params;
    const [client, s] = await Promise.all([db.client.findUnique({ where: { id } }), db.settings.findUniqueOrThrow({ where: { id: "agency" } })]);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { from, to } = statementPeriod(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"), todayKey());
    const ledger = await clientLedger(db, id, from, to);
    const pdf = await renderStatementPdf({
      agency: { name: s.agencyName, address: [s.address, s.city, s.state, s.pincode].filter(Boolean).join(", "), state: `${s.state} (${s.stateCode})`, gstin: s.gstin, pan: s.pan, email: s.email, phone: s.phone, website: s.website },
      logoKey: s.logoKey,
      client: { name: client.companyName, address: [client.billingAddress, client.city, client.state, client.pincode].filter(Boolean).join(", "), gstin: client.gstin },
      from, to, ...ledger,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="statement-${from}-to-${to}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
