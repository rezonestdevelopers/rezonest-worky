import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getInvoiceFormOptions } from "@/server/queries/invoices";
import { newInvoiceDefaults } from "../form-values";
import { InvoiceForm } from "../invoice-form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const options = await getInvoiceFormOptions();
  const client = idParam(sp, "client");
  const clientId = options.clients.some((c) => c.value === client) ? client! : "";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="New invoice" description="Saved as a draft. You'll review it before issuing." back={{ href: "/invoices", label: "Invoices" }} />
      <InvoiceForm invoiceId={null} options={options} defaults={newInvoiceDefaults(todayKey(), options, clientId)} />
    </div>
  );
}
