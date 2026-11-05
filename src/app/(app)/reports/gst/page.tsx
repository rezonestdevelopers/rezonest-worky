import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { param, type SearchParams } from "@/lib/list-params";
import { financialYearMonths, financialYearOptions } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { loadReport } from "@/server/report-loader";
import { DownloadButtons, ReportView } from "../report-view";

export const metadata: Metadata = { title: "GST summary" };

export default async function GstReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const today = todayKey();
  const { fy } = financialYearMonths(param(await searchParams, "fy"), today);
  return (
    <div className="space-y-4">
      <PageHeader title="GST summary" description="For your CA. Please have them check it before filing." back={{ href: "/reports", label: "Reports" }} actions={<DownloadButtons kind="gst" query={`fy=${fy}`} />} />
      <nav aria-label="Financial year" className="flex flex-wrap gap-1.5">
        {financialYearOptions(today).map((y) => (
          <a key={y} href={`/reports/gst?fy=${y}`} aria-current={y === fy ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent", y === fy && "border-primary/40 bg-primary/10 font-medium")}>{y}</a>
        ))}
      </nav>
      <Suspense key={fy} fallback={<ListSkeleton />}>
        <Report fy={fy} />
      </Suspense>
    </div>
  );
}

async function Report({ fy }: { fy: string }) {
  const doc = await loadReport("gst", { fy });
  return doc && <ReportView doc={doc} />;
}
