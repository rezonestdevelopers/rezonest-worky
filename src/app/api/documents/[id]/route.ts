import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { canPreview, isFinanceDocument } from "@/lib/file-types";
import { can } from "@/lib/permissions";
import { getFile } from "@/lib/storage";
import { loadViewer, taskScope } from "@/server/services/tasks";

/**
 * A file for someone allowed to see it. Task files follow who can see the task; other client files
 * need sales access, and bills and invoices need finance access. It downloads unless ?view=1 asks to
 * preview it, which only PDFs and images checked at upload can do.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertPermission("work.own");
    const id = (await params).id;
    const doc = await db.document.findFirst({ where: { id, archivedAt: null } });
    const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!doc) return notFound;

    let allowed = false;
    if (doc.taskId) {
      const viewer = await loadViewer(db, user);
      allowed = (await db.task.count({ where: { id: doc.taskId, archivedAt: null, ...taskScope(viewer) } })) > 0;
    }
    if (!allowed) allowed = can(user.role, "sales.manage") && (!isFinanceDocument(doc.category) || can(user.role, "finance.manage"));
    if (!allowed) return notFound;

    const file = await getFile(doc.storageKey);
    if (!file) return notFound;
    const safeName = doc.name.replace(/[^\w.\- ]+/g, "_");
    const preview = req.nextUrl.searchParams.get("view") === "1" && canPreview(doc.mimeType);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": preview ? doc.mimeType : "application/octet-stream",
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
