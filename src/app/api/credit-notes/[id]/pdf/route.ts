import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { pdfFileName, renderCreditNotePdf, type CreditNoteLine } from "@/lib/pdf/invoice-pdf";
import { loadInvoice } from "@/server/queries/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPermission("finance.manage");
    const note = await db.creditNote.findUnique({ where: { id: (await params).id } });
    const loaded = note && (await loadInvoice(note.invoiceId));
    if (!note || !loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Older notes have no line detail, so they show as one line.
    const lines: CreditNoteLine[] = (note.lines as CreditNoteLine[] | null) ?? [{ description: note.reason, sacCode: null, gstRate: "", taxable: note.taxableAmount.toString(), cgst: note.cgstAmount.toString(), sgst: note.sgstAmount.toString(), igst: note.igstAmount.toString(), total: note.totalAmount.toString() }];
    const pdf = await renderCreditNotePdf({ doc: loaded.doc, logoKey: loaded.logoKey, number: note.number, dateKey: dateOnlyKey(note.date), reason: note.reason, lines, taxable: note.taxableAmount, cgst: note.cgstAmount, sgst: note.sgstAmount, igst: note.igstAmount, roundOff: note.roundOff, total: note.totalAmount });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFileName(note.number)}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
