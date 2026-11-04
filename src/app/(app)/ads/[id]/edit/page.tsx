import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getContentFormOptions } from "@/server/queries/content";
import { CampaignForm } from "../../campaign-form";

export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work.manage");
  const { id } = await params;
  const c = await db.adCampaign.findUnique({ where: { id } });
  if (!c) notFound();
  if (c.archivedAt) redirect(`/ads/${id}`);
  const options = await getContentFormOptions({ clientId: c.clientId, projectId: c.projectId });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Edit ${c.name}`} back={{ href: `/ads/${id}`, label: "Back to campaign" }} />
      <CampaignForm
        id={id}
        clients={options.clients}
        projects={options.projects}
        defaults={{
          clientId: c.clientId, projectId: c.projectId ?? "", name: c.name, objective: c.objective ?? "", status: c.status, startDate: dateOnlyKey(c.startDate),
          endDate: c.endDate ? dateOnlyKey(c.endDate) : "", plannedBudget: c.plannedBudget.toString(),
        }}
      />
    </div>
  );
}
