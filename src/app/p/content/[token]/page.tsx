import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { contentLinkError, platformLabel } from "@/lib/content-plan";
import { formatDateKey, formatMonthKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { safeExternalUrl } from "@/lib/safe-url";
import { labelForFormat } from "@/lib/work-plan";
import { findContentLink } from "@/server/services/content";
import { ContentResponses, type PublicItem } from "./content-responses";

export const metadata: Metadata = { title: "Content for your approval", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-bg min-h-dvh px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <Image src="/logo.png" alt="Rezonest" width={150} height={41} className="h-9 w-auto" priority />
        {children}
      </div>
    </main>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <div className="glass rounded-2xl border p-8 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </Shell>
  );
}

/** The client's page. No login: it shows this client's content for this month and nothing else from the system. */
export default async function PublicContentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`content-view:${clientIp(await headers())}`, 120, 15 * 60_000).ok) {
    return <Message title="Too many requests" text="Please wait a few minutes and try again." />;
  }
  const link = await findContentLink(db, token);
  if (!link) return <Message title="This link is not valid" text="Please ask us for a new one." />;
  const problem = contentLinkError(link);
  if (problem) return <Message title="This link no longer works" text={problem} />;

  const [client, settings, rows] = await Promise.all([
    db.client.findUnique({ where: { id: link.clientId! }, select: { companyName: true, archivedAt: true } }),
    db.settings.findUnique({ where: { id: "agency" }, select: { agencyName: true, phone: true, email: true } }),
    // Only what the client should see. Design status, tasks and team details stay inside.
    db.contentCalendarItem.findMany({
      where: { clientId: link.clientId!, month: link.month!, archivedAt: null },
      orderBy: [{ publishDate: "asc" }, { id: "asc" }],
      select: {
        id: true, topic: true, format: true, platforms: true, caption: true, publishDate: true, approvalStatus: true, publishedAt: true, publishedLink: true, creativeDocId: true, creativeUrl: true,
        approvals: { orderBy: { createdAt: "desc" }, take: 1, select: { byName: true, comment: true, decision: true } },
      },
    }),
  ]);
  if (!client || client.archivedAt) return <Message title="This link is not valid" text="Please ask us for a new one." />;
  await db.publicLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });

  const docs = await db.document.findMany({ where: { id: { in: rows.map((r) => r.creativeDocId).filter((d): d is string => !!d) }, archivedAt: null }, select: { id: true, mimeType: true, name: true } });
  const items: PublicItem[] = rows.map((r) => {
    const doc = docs.find((d) => d.id === r.creativeDocId);
    const last = r.approvals[0];
    return {
      id: r.id,
      topic: r.topic,
      format: labelForFormat(r.format),
      platforms: r.platforms.map(platformLabel).join(", "),
      caption: r.caption,
      date: formatDateKey(r.publishDate),
      status: r.publishedAt ? "PUBLISHED" : r.approvalStatus,
      publishedLink: safeExternalUrl(r.publishedLink),
      image: doc?.mimeType.startsWith("image/") ? `/p/content/${token}/creative/${r.id}` : null,
      file: doc && !doc.mimeType.startsWith("image/") ? { href: `/p/content/${token}/creative/${r.id}`, name: doc.name } : null,
      link: safeExternalUrl(r.creativeUrl),
      note: last?.comment && last.decision === r.approvalStatus ? { by: last.byName, text: last.comment } : null,
    };
  });
  const contact = [settings?.phone, settings?.email].filter(Boolean).join(" · ");
  const waiting = items.filter((i) => i.status === "PENDING").length;

  return (
    <Shell>
      <div className="glass rounded-2xl border p-4 sm:p-6">
        <h1 className="text-lg font-semibold">{formatMonthKey(link.month!)} content for {client.companyName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length === 0 ? "Nothing is planned for this month yet." : waiting ? `Please look through each item and approve it, or tell us what to change. ${waiting} still need${waiting === 1 ? "s" : ""} your answer.` : "You've answered everything. Thank you!"}
        </p>
      </div>
      <ContentResponses token={token} items={items} />
      {contact && <p className="pb-6 text-center text-xs text-muted-foreground">Questions? {settings?.agencyName} · {contact}</p>}
    </Shell>
  );
}
