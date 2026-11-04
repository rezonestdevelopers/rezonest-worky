import { NextResponse, type NextRequest } from "next/server";
import { contentLinkError } from "@/lib/content-plan";
import { serveCreative } from "@/lib/creative-file";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findContentLink } from "@/server/services/content";

/** A creative for the client's page. The token decides what can be seen: only this client's items for this month. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  if (!rateLimit(`content-creative:${clientIp(req.headers)}`, 300, 15 * 60_000).ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const { token, itemId } = await params;
  const link = await findContentLink(db, token);
  if (!link || contentLinkError(link)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const item = await db.contentCalendarItem.findFirst({ where: { id: itemId, clientId: link.clientId!, month: link.month!, archivedAt: null }, select: { creativeDocId: true } });
  const doc = item?.creativeDocId ? await db.document.findUnique({ where: { id: item.creativeDocId } }) : null;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return serveCreative(doc);
}
