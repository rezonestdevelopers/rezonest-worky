import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { getFormOptions } from "@/server/queries/options";
import { LeadForm } from "../lead-form";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const user = await requirePermission("sales.manage");
  const options = await getFormOptions();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="New lead" back={{ href: "/leads", label: "Leads" }} />
      <LeadForm
        leadId={null}
        options={options}
        defaults={{
          contactName: "", companyName: "", phone: "", whatsapp: "", email: "", sectorId: "", city: "", leadSourceId: "",
          servicesInterested: [], approxBudget: "", requirementNotes: "", nextFollowUpDate: "", ownerId: user.id,
        }}
      />
    </div>
  );
}
