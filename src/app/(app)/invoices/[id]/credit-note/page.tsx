import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { toDecimal } from "@/lib/money/decimal";
import { CreditNoteForm } from "./credit-note-form";

export const metadata: Metadata = { title: "New credit note" };

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, creditNotes: true } });
  if (!invoice) notFound();
  if (invoice.type !== "TAX" || invoice.status !== "ISSUED") redirect(`/invoices/${id}`);
  const credited = new Map<string, ReturnType<typeof toDecimal>>();
  for (const cn of invoice.creditNotes) for (const l of (cn.lines as { itemId?: string; taxable: string }[] | null) ?? []) if (l.itemId) credited.set(l.itemId, (credited.get(l.itemId) ?? toDecimal(0)).plus(l.taxable));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="New credit note" description={`Against ${invoice.number}. The invoice stays as issued; this reduces what's owed.`} back={{ href: `/invoices/${id}`, label: invoice.number ?? "Invoice" }} />
      <CreditNoteForm
        invoiceId={id}
        today={todayKey()}
        minDate={dateOnlyKey(invoice.invoiceDate)}
        taxMode={invoice.taxMode}
        balance={invoice.balanceDue.toString()}
        lines={invoice.items.map((i) => ({ id: i.id, description: i.description, gstRate: i.gstRate.toString(), left: toDecimal(i.taxableValue).minus(credited.get(i.id) ?? 0).toFixed(2) }))}
      />
    </div>
  );
}
