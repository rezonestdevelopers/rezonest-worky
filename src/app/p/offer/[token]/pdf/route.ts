import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { pdfFileName, renderOfferPdf } from "@/lib/pdf/offer-pdf";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findOfferLink, loadOfferDocument } from "@/server/services/offers";

/** The client's PDF download. No login: the token alone gives access to this one offer. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`offer-pdf:${clientIp(req.headers)}`, 30, 15 * 60_000).ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const link = await findOfferLink(db, (await params).token);
  if (!link || link.revokedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const loaded = await loadOfferDocument(db, link.offerId!);
  if (!loaded || loaded.offer.archivedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await renderOfferPdf(loaded.doc, loaded.settings.logoKey);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(loaded.doc.number)}"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
