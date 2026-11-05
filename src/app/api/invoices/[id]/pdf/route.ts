import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { loadInvoice } from "@/server/queries/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPermission("finance.manage");
    const loaded = await loadInvoice((await params).id);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pdf = await renderInvoicePdf(loaded.doc, { logoKey: loaded.logoKey, signatureKey: loaded.signatureKey, payAmount: loaded.invoice.balanceDue });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFileName(loaded.doc.number)}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
