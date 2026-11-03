import type { Metadata } from "next";
import { ImportWizard } from "@/components/shared/import-wizard";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Import clients" };

export default async function ImportClientsPage() {
  await requirePermission("sales.manage");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Import clients" description="Bring in your existing clients from Excel." back={{ href: "/clients", label: "Clients" }} />
      <ImportWizard kind="clients" nameField="companyName" secondaryField="contactName" />
    </div>
  );
}
