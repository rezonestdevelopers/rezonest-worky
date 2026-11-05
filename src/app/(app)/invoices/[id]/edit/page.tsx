import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getInvoiceFormOptions } from "@/server/queries/invoices";
import { InvoiceForm } from "../../invoice-form";

export const metadata: Metadata = { title: "Edit draft invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!invoice) notFound();
  if (invoice.status !== "DRAFT") redirect(`/invoices/${id}`);
  const options = await getInvoiceFormOptions({ clientId: invoice.clientId });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Edit draft invoice" back={{ href: `/invoices/${id}`, label: "Invoice" }} />
      <InvoiceForm
        invoiceId={id}
        options={options}
        defaults={{
          clientId: invoice.clientId,
          projectId: invoice.projectId ?? "",
          type: invoice.type,
          gstEnabled: invoice.taxMode !== "NO_GST",
          invoiceDate: dateOnlyKey(invoice.invoiceDate),
          dueDate: dateOnlyKey(invoice.dueDate),
          terms: invoice.terms ?? "",
          notes: invoice.notes ?? "",
          items: invoice.items.map((i) => ({
            id: i.id,
            serviceId: i.serviceId ?? "",
            description: i.description,
            sacCode: i.sacCode ?? "",
            quantity: i.quantity.toString(),
            unit: i.unit ?? "",
            rate: i.rate.toString(),
            discountType: i.discountType ?? "",
            discountValue: i.discountValue.isZero() ? "" : i.discountValue.toString(),
            gstRate: i.gstRate.toString(),
          })),
        }}
      />
    </div>
  );
}
