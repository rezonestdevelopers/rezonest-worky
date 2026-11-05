import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { statementPeriod } from "@/lib/invoice-rules";
import { param, type SearchParams } from "@/lib/list-params";
import { loadReport } from "@/server/report-loader";
import { DownloadButtons, ReportView } from "../report-view";

export const metadata: Metadata = { title: "Agency report" };

export default async function AgencyReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const { from, to } = statementPeriod(param(sp, "from"), param(sp, "to"), todayKey());
  return (
    <div className="space-y-4">
      <PageHeader title="Agency report" description="How the agency is doing, before GST." back={{ href: "/reports", label: "Reports" }} actions={<DownloadButtons kind="agency" query={`from=${from}&to=${to}`} />} />
      <Card>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
            <div className="space-y-1.5"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
            <Button type="submit" variant="outline">Show</Button>
          </form>
        </CardContent>
      </Card>
      <Suspense key={`${from}${to}`} fallback={<ListSkeleton />}>
        <Report from={from} to={to} />
      </Suspense>
    </div>
  );
}

async function Report({ from, to }: { from: string; to: string }) {
  const doc = await loadReport("agency", { from, to });
  return doc && <ReportView doc={doc} />;
}
