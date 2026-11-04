import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { platformLabel } from "@/lib/content-plan";
import { formatDateKey, monthKeyOf, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { statusDef } from "@/lib/status";
import { labelForFormat } from "@/lib/work-plan";
import { getContentForExport } from "@/server/queries/content";
import { loadViewer } from "@/server/services/tasks";

export async function GET(req: NextRequest) {
  try {
    const user = await assertPermission("work.own");
    const sp = Object.fromEntries(req.nextUrl.searchParams);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month : monthKeyOf(todayKey());
    const rows = await getContentForExport(sp, await loadViewer(db, user), month);
    const buffer = await buildWorkbook(
      "Content",
      [
        { header: "Publish date", key: "publishDate", width: 13 },
        { header: "Client", key: "client", width: 34 },
        { header: "Topic", key: "topic", width: 46 },
        { header: "Format", key: "format", width: 11 },
        { header: "Platforms", key: "platforms", width: 28 },
        { header: "Design", key: "designStatus", width: 13 },
        { header: "Approval", key: "approvalStatus", width: 19 },
        { header: "Published", key: "published", width: 10 },
        { header: "Link", key: "publishedLink", width: 40 },
      ],
      rows.map((r) => ({
        ...r,
        publishDate: formatDateKey(r.publishDate),
        format: labelForFormat(r.format),
        platforms: r.platforms.map(platformLabel).join(", "),
        designStatus: statusDef("design", r.designStatus).label,
        approvalStatus: statusDef("approval", r.approvalStatus).label,
        published: r.published ? "Yes" : "No",
        publishedLink: r.publishedLink ?? "",
      })),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="content-${month}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
