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
import { monthKeyOf, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, type SearchParams } from "@/lib/list-params";
import { loadReport, reportMonth } from "@/server/report-loader";
import { DownloadButtons, ReportView } from "../report-view";
import { EmailReportButton, ReportNoteForm } from "./monthly-actions";

export const metadata: Metadata = { title: "Monthly client report" };

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs";

export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const today = todayKey();
  const month = reportMonth(param(sp, "month"), today);
  const clients = await db.client.findMany({ where: { archivedAt: null }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true, email: true } });
  const asked = idParam(sp, "client");
  const client = clients.find((c) => c.id === asked) ?? null;
  const note = client ? await db.clientReportNote.findUnique({ where: { clientId_month: { clientId: client.id, month } } }) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Monthly report for a client"
        description="Branded, with no prices, costs or team names."
        back={{ href: "/reports", label: "Reports" }}
        actions={client ? <div className="flex flex-wrap gap-2"><DownloadButtons kind="monthly" query={`client=${client.id}&month=${month}`} /><EmailReportButton clientId={client.id} month={month} defaultTo={client.email ?? ""} /></div> : undefined}
      />
      <Card>
        <CardContent>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <select id="client" name="client" className={selectClass} defaultValue={client?.id ?? ""}>
                <option value="">Choose a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="month">Month</Label><Input id="month" name="month" type="month" max={monthKeyOf(today)} defaultValue={month} /></div>
            <Button type="submit" variant="outline">Show</Button>
          </form>
        </CardContent>
      </Card>
      {client ? (
        <>
          <ReportNoteForm key={`${client.id}${month}`} clientId={client.id} month={month} highlights={note?.highlights ?? ""} nextPlan={note?.nextPlan ?? ""} />
          <Suspense key={`${client.id}${month}${note?.updatedAt.getTime() ?? 0}`} fallback={<ListSkeleton />}>
            <Report clientId={client.id} month={month} />
          </Suspense>
        </>
      ) : (
        <Card><CardContent><EmptyState title="Choose a client" hint="Then pick the month. It starts on last month, since that's the one that's finished." /></CardContent></Card>
      )}
    </div>
  );
}

async function Report({ clientId, month }: { clientId: string; month: string }) {
  const doc = await loadReport("monthly", { client: clientId, month });
  return doc && <ReportView doc={doc} />;
}
