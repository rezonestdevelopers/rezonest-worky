import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import type { ContentItemInput } from "@/lib/validators/delivery";
import { dateOnlyKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getContentFormOptions } from "@/server/queries/content";
import { ContentForm } from "../../content-form";

export const metadata: Metadata = { title: "Edit content" };

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work.manage");
  const { id } = await params;
  const item = await db.contentCalendarItem.findUnique({ where: { id } });
  if (!item) notFound();
  if (item.archivedAt || item.publishedAt) redirect(`/content/${id}`);
  const options = await getContentFormOptions({ clientId: item.clientId, projectId: item.projectId });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Edit content" back={{ href: `/content/${id}`, label: "Back to item" }} />
      <ContentForm
        id={id}
        clients={options.clients}
        projects={options.projects}
        defaults={{
          clientId: item.clientId, projectId: item.projectId ?? "", format: item.format, platforms: item.platforms as ContentItemInput["platforms"], topic: item.topic, caption: item.caption ?? "",
          publishDate: item.publishDate ? dateOnlyKey(item.publishDate) : todayKey(),
        }}
      />
    </div>
  );
}
