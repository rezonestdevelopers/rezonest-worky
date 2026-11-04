import "server-only";
import { NextResponse } from "next/server";
import { getFile } from "@/lib/storage";

const INLINE = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Serves a creative. Images open in the page; anything else downloads. Files can't run scripts:
 * the type is the one checked at upload, the browser mustn't guess it, and the page is sandboxed.
 */
export async function serveCreative(doc: { name: string; storageKey: string; mimeType: string }): Promise<NextResponse> {
  const file = await getFile(doc.storageKey);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const inline = INLINE.has(doc.mimeType);
  const safeName = doc.name.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": inline ? doc.mimeType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
