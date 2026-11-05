import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getPayableClients } from "@/server/queries/invoices";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const clients = await getPayableClients();
  const client = idParam(sp, "client");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Record payment" description="Split it across invoices, or leave some as the client's advance." back={{ href: "/payments", label: "Payments" }} />
      <PaymentForm
        today={todayKey()}
        clients={clients.map((c) => ({ value: c.id, label: c.companyName }))}
        initialClient={clients.some((c) => c.id === client) ? client! : ""}
        focusInvoice={idParam(sp, "invoice") ?? ""}
      />
    </div>
  );
}
