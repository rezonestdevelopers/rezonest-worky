import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { renderTemplate } from "@/lib/email-templates";
import { issueProblems, paymentModeLabel, upiLink } from "@/lib/invoice-rules";
import type { InvoiceParty } from "@/lib/invoice-document";
import { formatINR } from "@/lib/money/format";
import { sum, toDecimal } from "@/lib/money/decimal";
import { loadInvoice } from "@/server/queries/invoices";
import { getTemplate } from "@/server/services/email-templates";
import { InvoiceActions, IssueProblems, type ReminderTexts } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoice" };

const Party = ({ title, p }: { title: string; p: InvoiceParty }) => (
  <div className="min-w-0 text-sm">
    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
    <div className="mt-1 font-medium">{p.name}</div>
    {p.contact && <div>{p.contact}</div>}
    {p.address && <div className="text-muted-foreground">{p.address}</div>}
    {p.gstin && <div className="text-muted-foreground">GSTIN: {p.gstin}</div>}
    {p.pan && <div className="text-muted-foreground">PAN: {p.pan}</div>}
    {p.email && <div className="break-all text-muted-foreground">{p.email}</div>}
    {p.phone && <div className="text-muted-foreground">{p.phone}</div>}
  </div>
);

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const loaded = await loadInvoice(id);
  if (!loaded || (loaded.invoice.status === "CANCELLED" && !loaded.invoice.number)) notFound();
  const { invoice, doc, settings } = loaded;
  const today = todayKey();
  const client = invoice.client;

  const values = (amount: string) => ({
    contactName: doc.client.contact ?? doc.client.name,
    invoiceNumber: doc.number,
    amount,
    dueDate: doc.dueDate,
    upiId: doc.bank.upiId ?? "",
    agencyName: doc.agency.name,
  });
  const [send, polite, firm, final] = await Promise.all(["invoice_send", "payment_reminder_polite", "payment_reminder_firm", "payment_reminder_final"].map((k) => getTemplate(db, k)));
  const balance = formatINR(invoice.balanceDue);
  const reminders: ReminderTexts = { polite: renderTemplate(polite, values(balance)), firm: renderTemplate(firm, values(balance)), final: renderTemplate(final, values(balance)) };

  const problems = invoice.status === "DRAFT" ? issueProblems({ type: invoice.type, taxMode: invoice.taxMode, agencyGstin: settings.gstin, lines: invoice.items, invoiceDateKey: dateOnlyKey(invoice.invoiceDate), todayKey: today, grandTotal: invoice.grandTotal }) : [];
  const credited = new Map<string, ReturnType<typeof toDecimal>>();
  for (const cn of invoice.creditNotes) for (const l of (cn.lines as { itemId?: string; taxable: string }[] | null) ?? []) if (l.itemId) credited.set(l.itemId, (credited.get(l.itemId) ?? toDecimal(0)).plus(l.taxable));
  const creditableTaxable = sum(invoice.items.map((i) => toDecimal(i.taxableValue).minus(credited.get(i.id) ?? 0)));
  const hasCreditRoom = invoice.balanceDue.greaterThan(0) && creditableTaxable.greaterThan(0);
  const allocations = invoice.allocations.filter((a) => !a.payment.voidedAt);

  const qr = invoice.status === "ISSUED" && doc.bank.upiId && invoice.balanceDue.greaterThan(0)
    ? await QRCode.toDataURL(upiLink({ upiId: doc.bank.upiId, payee: doc.agency.name, amount: invoice.balanceDue, note: doc.number }), { margin: 1, width: 200 })
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={invoice.number ?? "Draft invoice"}
        description={`${doc.title.charAt(0)}${doc.title.slice(1).toLowerCase()} for ${doc.client.name}`}
        back={{ href: "/invoices", label: "Invoices" }}
        actions={
          <InvoiceActions
            id={id}
            clientId={invoice.clientId}
            type={invoice.type}
            status={invoice.status}
            canConvert={invoice.type === "PROFORMA" && invoice.status === "ISSUED" && !invoice.convertedTo}
            hasCreditRoom={hasCreditRoom}
            balanceDue={invoice.balanceDue.greaterThan(0)}
            problems={problems}
            today={today}
            email={doc.client.email ?? client.email ?? ""}
            phone={client.whatsapp ?? client.phone ?? null}
            mail={renderTemplate(send, values(doc.grandTotal))}
            reminders={reminders}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="invoice" value={invoice.status} />
        {invoice.type === "TAX" && invoice.status === "ISSUED" && <StatusBadge kind="payment" value={invoice.paymentStatus} />}
        {invoice.project && <Link href={`/projects/${invoice.project.id}`} className="text-sm text-muted-foreground hover:underline">{invoice.project.name}</Link>}
        <Link href={`/clients/${invoice.clientId}`} className="text-sm text-muted-foreground hover:underline">{client.companyName}</Link>
        {invoice.convertedFrom && <Link href={`/invoices/${invoice.convertedFrom.id}`} className="text-sm text-muted-foreground hover:underline">From proforma {invoice.convertedFrom.number}</Link>}
        {invoice.convertedTo && <Link href={`/invoices/${invoice.convertedTo.id}`} className="text-sm font-medium hover:underline">Converted to {invoice.convertedTo.number}</Link>}
      </div>
      <IssueProblems problems={problems} />
      {invoice.status === "CANCELLED" && <p className="rounded-lg border p-3 text-sm">Cancelled: {invoice.cancelReason}</p>}

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Party title="From" p={doc.agency} />
            <Party title="Bill to" p={doc.client} />
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Invoice date</dt><dd className="tabular-nums">{doc.invoiceDate}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Due date</dt><dd className="tabular-nums">{doc.dueDate}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Place of supply</dt><dd className="text-right">{doc.placeOfSupply}</dd></div>
            </dl>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Description</TableHead>
                  <TableHead>SAC</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  {doc.gst && <TableHead className="text-right">GST</TableHead>}
                  {doc.gst && <TableHead className="text-right">Tax</TableHead>}
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-80 whitespace-normal">{l.description}</TableCell>
                    <TableCell>{l.sac || "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.rate}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.discount || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.taxable}</TableCell>
                    {doc.gst && <TableCell className="text-right tabular-nums">{l.gst}</TableCell>}
                    {doc.gst && <TableCell className="text-right tabular-nums">{l.tax}</TableCell>}
                    <TableCell className="text-right tabular-nums">{l.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              <p><span className="text-muted-foreground">In words: </span>{doc.amountInWords}</p>
              {doc.taxNote && <p className="text-muted-foreground">{doc.taxNote}</p>}
              {(doc.bank.bankName || doc.bank.upiId) && (
                <div className="flex flex-wrap gap-3">
                  {qr && <Image src={qr} alt={`UPI QR code to pay ${balance}`} width={100} height={100} unoptimized className="rounded-md" />}
                  <div className="text-muted-foreground">
                    {doc.bank.bankName && <div>{doc.bank.bankName}{doc.bank.branch ? `, ${doc.bank.branch}` : ""}</div>}
                    {doc.bank.accountNumber && <div>Account: {doc.bank.accountNumber}</div>}
                    {doc.bank.ifsc && <div>IFSC: {doc.bank.ifsc}</div>}
                    {doc.bank.upiId && <div>UPI: {doc.bank.upiId}</div>}
                  </div>
                </div>
              )}
              {doc.notes && <p className="whitespace-pre-wrap">{doc.notes}</p>}
              {doc.terms && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{doc.terms}</p>}
            </div>
            <dl className="space-y-1 self-start text-sm" data-testid="invoice-summary">
              {doc.summary.map((r) => (
                <div key={r.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{r.label}</dt><dd className="tabular-nums">{r.value}</dd></div>
              ))}
              <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="grand-total">{doc.grandTotal}</dd></div>
              {doc.settled.map((r) => (
                <div key={r.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{r.label}</dt><dd className="tabular-nums">−{r.value}</dd></div>
              ))}
              {doc.showBalance && <div className="flex justify-between gap-3 font-semibold"><dt>Balance due</dt><dd className="tabular-nums" data-testid="balance-due">{doc.balanceDue}</dd></div>}
            </dl>
          </div>
        </CardContent>
      </Card>

      {allocations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link href={`/payments/${a.payment.id}`} className="font-medium hover:underline">{formatDateKey(dateOnlyKey(a.payment.date))} · {paymentModeLabel(a.payment.mode)}{a.payment.reference ? ` · ${a.payment.reference}` : ""}</Link>
                  <span className="tabular-nums">{formatINR(a.amount)}{a.tdsAmount.greaterThan(0) && ` + TDS ${formatINR(a.tdsAmount)}${a.payment.tdsSection ? ` (${a.payment.tdsSection})` : ""}`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {invoice.creditNotes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Credit notes</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {invoice.creditNotes.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <a href={`/api/credit-notes/${c.id}/pdf`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{c.number}</a>
                    <span className="text-muted-foreground"> · {formatDateKey(dateOnlyKey(c.date))} · {c.reason}</span>
                  </div>
                  <span className="tabular-nums">{formatINR(c.totalAmount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
