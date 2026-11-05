import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey } from "@/lib/dates";
import { advanceLeft, paymentModeLabel } from "@/lib/invoice-rules";
import { formatINR } from "@/lib/money/format";
import { getOpenInvoices, getOpenProformas, getPayment } from "@/server/queries/invoices";
import { ApplyAdvanceForm, ConvertProformaPrompt, RemoveAllocationButton, VoidPaymentButton } from "./payment-actions";

export const metadata: Metadata = { title: "Payment" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right tabular-nums">{children}</dd>
  </div>
);

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) notFound();
  const voided = !!payment.voidedAt;
  const left = advanceLeft(payment.amount, payment.allocations);
  const hasAdvance = !voided && left.greaterThan(0);
  const [invoices, proformas] = await Promise.all([hasAdvance ? getOpenInvoices(payment.clientId) : [], hasAdvance ? getOpenProformas(payment.clientId) : []]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={`Payment of ${formatINR(payment.amount)}`}
        description={`From ${payment.client.companyName} on ${formatDateKey(dateOnlyKey(payment.date))}`}
        back={{ href: "/payments", label: "Payments" }}
        actions={voided ? <Badge tone="grey">Void</Badge> : <VoidPaymentButton id={id} />}
      />
      {voided && <p className="rounded-lg border p-3 text-sm">Voided: {payment.voidReason}</p>}
      {hasAdvance && proformas.length > 0 && <ConvertProformaPrompt paymentId={id} paymentDate={dateOnlyKey(payment.date)} left={left.toFixed(2)} proformas={proformas.map((p) => ({ id: p.id, number: p.number ?? "", total: p.grandTotal.toString() }))} />}
      {hasAdvance && invoices.length > 0 && <ApplyAdvanceForm paymentId={id} left={left.toFixed(2)} invoices={invoices} />}
      <Card>
        <CardContent>
          <dl className="space-y-1.5 text-sm">
            <Row label="Client"><Link href={`/clients/${payment.client.id}`} className="hover:underline">{payment.client.companyName}</Link></Row>
            <Row label="Mode">{paymentModeLabel(payment.mode)}</Row>
            <Row label="Reference">{payment.reference ?? "—"}</Row>
            <Row label="TDS">{payment.tdsAmount.greaterThan(0) ? `${formatINR(payment.tdsAmount)}${payment.tdsSection ? ` (${payment.tdsSection})` : ""}` : "—"}</Row>
            <Row label="Advance left"><span data-testid="payment-advance">{voided ? "—" : formatINR(left)}</span></Row>
            {payment.notes && <Row label="Notes">{payment.notes}</Row>}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Applied to</CardTitle></CardHeader>
        <CardContent>
          {payment.allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not applied to any invoice.</p>
          ) : (
            <ul className="divide-y text-sm">
              {payment.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/invoices/${a.invoice.id}`} className="font-medium whitespace-nowrap hover:underline">{a.invoice.number}</Link>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{formatINR(a.amount)}{a.tdsAmount.greaterThan(0) && ` + TDS ${formatINR(a.tdsAmount)}`}</span>
                    {!voided && <RemoveAllocationButton paymentId={id} invoiceId={a.invoice.id} number={a.invoice.number ?? "this invoice"} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
