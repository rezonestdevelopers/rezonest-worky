import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import type { SearchParams } from "@/lib/list-params";
import { formatINR } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { getPayableClients, getInvoiceList, getInvoiceSummary } from "@/server/queries/invoices";
import { InvoicesTable } from "./invoices-table";

export const metadata: Metadata = { title: "Invoices" };

const Stat = ({ label, value, tone, href }: { label: string; value: string | number; tone?: string; href: string }) => (
  <Link href={href} scroll={false}>
    <Card className="gap-1 py-4 transition-colors hover:bg-accent/40">
      <CardContent className="px-4">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>{value}</div>
      </CardContent>
    </Card>
  </Link>
);

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="Once issued, an invoice is locked. Corrections go through a credit note."
        actions={<Button size="sm" asChild><Link href="/invoices/new"><Plus /> New invoice</Link></Button>}
      />
      <Suspense fallback={<ListSkeleton />}>
        <InvoiceList sp={sp} />
      </Suspense>
    </div>
  );
}

async function InvoiceList({ sp }: { sp: SearchParams }) {
  const [list, clients, summary] = await Promise.all([getInvoiceList(sp), getPayableClients(), getInvoiceSummary()]);
  const filtered = ["q", "type", "status", "payment", "client"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={`Outstanding (${summary.outstandingCount})`} value={formatINR(summary.outstanding, { decimals: false })} href="/payments/ageing" />
        <Stat label={`Overdue (${summary.overdueCount})`} value={formatINR(summary.overdue, { decimals: false })} tone={summary.overdueCount ? "text-tone-red" : undefined} href="/invoices?payment=OVERDUE" />
        <Stat label="Drafts to review" value={summary.drafts} tone={summary.drafts ? "text-tone-amber" : undefined} href="/invoices?status=DRAFT" />
      </div>
      <ListToolbar
        placeholder="Search number or client…"
        exportHref="/api/export/invoices"
        filters={[
          { key: "type", label: "Type", options: [{ value: "TAX", label: "Tax invoice" }, { value: "PROFORMA", label: "Proforma" }] },
          { key: "status", label: "Status", options: [{ value: "DRAFT", label: "Draft" }, { value: "ISSUED", label: "Issued" }, { value: "CONVERTED", label: "Converted" }, { value: "CANCELLED", label: "Cancelled" }] },
          { key: "payment", label: "Payment", options: [{ value: "UNPAID", label: "Unpaid" }, { value: "PARTIALLY_PAID", label: "Partially paid" }, { value: "PAID", label: "Paid" }, { value: "OVERDUE", label: "Overdue" }] },
          { key: "client", label: "Client", options: clients.map((c) => ({ value: c.id, label: c.companyName })) },
        ]}
      />
      <InvoicesTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} filtered={filtered} />
    </div>
  );
}
