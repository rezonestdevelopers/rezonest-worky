import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { pdfFileName, renderOfferPdf } from "@/lib/pdf/offer-pdf";
import { loadOfferDocument } from "@/server/services/offers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPermission("sales.manage");
    const loaded = await loadOfferDocument(db, (await params).id);
    if (!loaded || loaded.offer.isTemplate) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pdf = await renderOfferPdf(loaded.doc, loaded.settings.logoKey);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(loaded.doc.number)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
