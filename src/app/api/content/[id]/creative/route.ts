import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { serveCreative } from "@/lib/creative-file";
import { db } from "@/lib/db";
import { contentScope } from "@/server/services/content";
import { loadViewer } from "@/server/services/tasks";

/** A creative for someone allowed to see its content item. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertPermission("work.own");
    const viewer = await loadViewer(db, user);
    const item = await db.contentCalendarItem.findFirst({ where: { id: (await params).id, ...contentScope(viewer) }, select: { creativeDocId: true } });
    const doc = item?.creativeDocId ? await db.document.findUnique({ where: { id: item.creativeDocId } }) : null;
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return await serveCreative(doc);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
