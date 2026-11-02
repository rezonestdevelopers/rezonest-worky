import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getFile, isSafeKey, mimeFor } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isSafeKey(key)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!key.startsWith("public/")) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const file = await getFile(key);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": mimeFor(key),
      "Cache-Control": key.startsWith("public/") ? "public, max-age=31536000, immutable" : "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
