import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** A backup holds everything, so only someone who can change settings can download it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPermission("settings.manage");
    const run = await db.backupRun.findUnique({ where: { id: (await params).id } });
    const file = run?.storageKey && !run.deletedAt ? await getFile(run.storageKey) : null;
    if (!run || !file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(file), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="rezonest-${run.day}.dump"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
