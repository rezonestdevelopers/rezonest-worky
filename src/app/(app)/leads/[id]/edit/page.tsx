import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getFormOptions } from "@/server/queries/options";
import { LeadForm } from "../../lead-form";

export const metadata: Metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) notFound();
  if (lead.archivedAt) redirect(`/leads/${id}`);
  const options = await getFormOptions([lead.sectorId, lead.leadSourceId, lead.ownerId, ...lead.servicesInterested]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Edit ${lead.contactName}`} back={{ href: `/leads/${id}`, label: "Back to lead" }} />
      <LeadForm
        leadId={id}
        options={options}
        defaults={{
          contactName: lead.contactName,
          companyName: lead.companyName ?? "",
          phone: lead.phone ?? "",
          whatsapp: lead.whatsapp ?? "",
          email: lead.email ?? "",
          sectorId: lead.sectorId ?? "",
          city: lead.city ?? "",
          leadSourceId: lead.leadSourceId ?? "",
          servicesInterested: lead.servicesInterested,
          approxBudget: lead.approxBudget?.toString() ?? "",
          requirementNotes: lead.requirementNotes ?? "",
          nextFollowUpDate: lead.nextFollowUpDate ? dateOnlyKey(lead.nextFollowUpDate) : "",
          ownerId: lead.ownerId ?? "",
        }}
      />
    </div>
  );
}
