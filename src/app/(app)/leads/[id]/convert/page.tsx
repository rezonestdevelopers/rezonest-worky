import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getFormOptions } from "@/server/queries/options";
import { ClientForm } from "../../../clients/client-form";

export const metadata: Metadata = { title: "Convert lead" };

export default async function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.manage");
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) notFound();
  if (lead.convertedClientId || lead.archivedAt) redirect(`/leads/${id}`);
  const options = await getFormOptions([lead.sectorId, lead.leadSourceId]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Convert to client"
        description="Details from the lead are filled in. Add the state and any GST details, then save. The lead will be marked Won."
        back={{ href: `/leads/${id}`, label: "Back to lead" }}
      />
      <ClientForm
        mode={{ kind: "convert", leadId: id }}
        options={options}
        defaults={{
          companyName: lead.companyName ?? lead.contactName,
          contactName: lead.contactName,
          contactDesignation: "",
          phone: lead.phone ?? "",
          whatsapp: lead.whatsapp ?? "",
          email: lead.email ?? "",
          website: "",
          sectorId: lead.sectorId ?? "",
          city: lead.city ?? "",
          country: "India",
          stateCode: "27",
          billingAddress: "",
          pincode: "",
          gstin: "",
          pan: "",
          leadSourceId: lead.leadSourceId ?? "",
          accountManagerId: lead.ownerId ?? user.id,
          tags: "",
          notes: lead.requirementNotes ?? "",
          status: "ACTIVE",
        }}
      />
    </div>
  );
}
