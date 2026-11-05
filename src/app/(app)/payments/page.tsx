import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { paymentModeLabel } from "@/lib/invoice-rules";
import type { SearchParams } from "@/lib/list-params";
import { PAYMENT_MODES } from "@/lib/validators/invoice";
import { getPayableClients, getPaymentList } from "@/server/queries/invoices";
import { PaymentsTable } from "./payments-table";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        description="Money received. Anything not applied to an invoice stays as the client's advance."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/payments/ageing"><CalendarClock /> Ageing report</Link></Button>
            <Button size="sm" asChild><Link href="/payments/new"><Plus /> Record payment</Link></Button>
          </div>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <PaymentList sp={sp} />
      </Suspense>
    </div>
  );
}

async function PaymentList({ sp }: { sp: SearchParams }) {
  const [list, clients] = await Promise.all([getPaymentList(sp), getPayableClients()]);
  const filtered = ["q", "mode", "client", "show"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search reference, notes, client…"
        exportHref="/api/export/payments"
        filters={[
          { key: "mode", label: "Mode", options: PAYMENT_MODES.map((m) => ({ value: m, label: paymentModeLabel(m) })) },
          { key: "client", label: "Client", options: clients.map((c) => ({ value: c.id, label: c.companyName })) },
          { key: "show", label: "Showing", options: [{ value: "void", label: "Voided" }] },
        ]}
      />
      <PaymentsTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} filtered={filtered} />
    </div>
  );
}
