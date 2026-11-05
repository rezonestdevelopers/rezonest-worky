import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { statementPeriod } from "@/lib/invoice-rules";
import { idParam, param, type SearchParams } from "@/lib/list-params";
import { loadReport } from "@/server/report-loader";
import { DownloadButtons, ReportView } from "../report-view";

export const metadata: Metadata = { title: "Client report" };

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs";

export default async function ClientReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const { from, to } = statementPeriod(param(sp, "from"), param(sp, "to"), todayKey());
  const clients = await db.client.findMany({ orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
  const asked = idParam(sp, "client");
  const clientId = clients.some((c) => c.id === asked) ? asked! : "";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Client report (internal)"
        description="Includes prices, costs and profit, so it's for you, not the client."
        back={{ href: "/reports", label: "Reports" }}
        actions={clientId ? <DownloadButtons kind="client" query={`client=${clientId}&from=${from}&to=${to}`} /> : undefined}
      />
      <Card>
        <CardContent>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <select id="client" name="client" className={selectClass} defaultValue={clientId}>
                <option value="">Choose a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
            <div className="space-y-1.5"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
            <Button type="submit" variant="outline">Show</Button>
          </form>
        </CardContent>
      </Card>
      {clientId ? (
        <Suspense key={`${clientId}${from}${to}`} fallback={<ListSkeleton />}>
          <Report clientId={clientId} from={from} to={to} />
        </Suspense>
      ) : (
        <Card><CardContent><EmptyState title="Choose a client" hint="Then pick the dates you want to look at." /></CardContent></Card>
      )}
    </div>
  );
}

async function Report({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const doc = await loadReport("client", { client: clientId, from, to });
  return doc && <ReportView doc={doc} />;
}
