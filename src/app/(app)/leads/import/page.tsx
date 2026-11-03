import type { Metadata } from "next";
import { ImportWizard } from "@/components/shared/import-wizard";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Import leads" };

export default async function ImportLeadsPage() {
  await requirePermission("sales.manage");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Import leads" description="Bring in your existing enquiries from Excel." back={{ href: "/leads", label: "Leads" }} />
      <ImportWizard kind="leads" nameField="contactName" secondaryField="companyName" />
    </div>
  );
}
