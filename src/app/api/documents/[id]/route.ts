import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { loadViewer, taskScope } from "@/server/services/tasks";

/** Downloads an attachment for someone allowed to see its task. Always a download, never shown inline. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertPermission("work.own");
    const viewer = await loadViewer(db, user);
    const doc = await db.document.findFirst({
      where: { id: (await params).id, archivedAt: null, task: { archivedAt: null, ...taskScope(viewer) } },
    });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const file = await getFile(doc.storageKey);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const safeName = doc.name.replace(/[^\w.\- ]+/g, "_");
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
