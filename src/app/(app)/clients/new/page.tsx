import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { getFormOptions } from "@/server/queries/options";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const user = await requirePermission("sales.manage");
  const options = await getFormOptions();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="New client" back={{ href: "/clients", label: "Clients" }} />
      <ClientForm
        mode={{ kind: "create" }}
        options={options}
        defaults={{
          companyName: "", contactName: "", contactDesignation: "", phone: "", whatsapp: "", email: "", website: "", sectorId: "",
          city: "", country: "India", stateCode: "27", billingAddress: "", pincode: "", gstin: "", pan: "", leadSourceId: "",
          accountManagerId: user.id, tags: "", notes: "", status: "ACTIVE",
        }}
      />
    </div>
  );
}
