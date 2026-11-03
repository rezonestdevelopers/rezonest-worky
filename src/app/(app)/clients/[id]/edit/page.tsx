import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getFormOptions } from "@/server/queries/options";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  const c = await db.client.findUnique({ where: { id } });
  if (!c) notFound();
  if (c.archivedAt) redirect(`/clients/${id}`);
  const options = await getFormOptions([c.sectorId, c.leadSourceId, c.accountManagerId]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Edit ${c.companyName}`} back={{ href: `/clients/${id}`, label: "Back to client" }} />
      <ClientForm
        mode={{ kind: "edit", clientId: id }}
        options={options}
        defaults={{
          companyName: c.companyName,
          contactName: "",
          contactDesignation: "",
          phone: c.phone ?? "",
          whatsapp: c.whatsapp ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          sectorId: c.sectorId ?? "",
          city: c.city ?? "",
          country: c.country,
          stateCode: c.stateCode,
          billingAddress: c.billingAddress ?? "",
          pincode: c.pincode ?? "",
          gstin: c.gstin ?? "",
          pan: c.pan ?? "",
          leadSourceId: c.leadSourceId ?? "",
          accountManagerId: c.accountManagerId ?? "",
          tags: c.tags.join(", "),
          notes: c.notes ?? "",
          status: c.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        }}
      />
    </div>
  );
}
