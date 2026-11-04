import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { adMetrics, totalEntries } from "@/lib/ad-metrics";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey, formatDateTime, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatINR, formatNumberIN } from "@/lib/money/format";
import { setCampaignArchivedAction } from "@/server/actions/delivery";
import { getCampaign } from "@/server/queries/ads";
import { BudgetBar } from "../budget-bar";
import { EntriesPanel } from "./entries-panel";

export const metadata: Metadata = { title: "Campaign" };

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card className="gap-1 py-4">
    <CardContent className="px-4">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </CardContent>
  </Card>
);

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work.manage");
  const { id } = await params;
  const [c, settings] = await Promise.all([getCampaign(id), db.settings.findUnique({ where: { id: "agency" }, select: { adBudgetAlertPercent: true } })]);
  if (!c) notFound();
  const archived = !!c.archivedAt;
  const alertPercent = settings?.adBudgetAlertPercent ?? 85;
  const totals = totalEntries(c.entries);
  const m = adMetrics(totals, c.plannedBudget);

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        back={{ href: "/ads", label: "Meta Ads" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="campaign" value={c.status} />
            <Link href={`/clients/${c.client.id}?tab=ads`} className="underline">{c.client.companyName}</Link>
            {c.objective && <span>{c.objective}</span>}
            <span className="tabular-nums">{formatDateKey(c.startDate)}{c.endDate ? ` to ${formatDateKey(c.endDate)}` : ""}</span>
          </span>
        }
        actions={
          archived ? (
            <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this campaign?" description="It comes back to your lists and budget alerts." confirmLabel="Restore" action={setCampaignArchivedAction.bind(null, id, false)} />
          ) : (
            <>
              <Button variant="outline" size="sm" asChild><Link href={`/ads/${id}/edit`}><Pencil /> Edit</Link></Button>
              <ConfirmButton label="Archive" icon={<Archive />} title="Archive this campaign?" description="It leaves your lists and stops budget alerts. Its results are kept." confirmLabel="Archive" action={setCampaignArchivedAction.bind(null, id, true)} />
            </>
          )
        }
      />
      {archived && <div role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">Archived on {formatDateTime(c.archivedAt)}.</div>}
      <Card>
        <CardHeader><CardTitle>Client&apos;s budget</CardTitle><span className="text-sm tabular-nums" data-testid="budget-line">{formatINR(totals.spend)} of {formatINR(c.plannedBudget)}</span></CardHeader>
        <CardContent><BudgetBar utilisation={m.utilisation} alertPercent={alertPercent} /></CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Impressions" value={formatNumberIN(totals.impressions)} />
        <Stat label="Clicks" value={formatNumberIN(totals.clicks)} />
        <Stat label="CTR" value={m.ctr === null ? "—" : `${m.ctr}%`} hint="Clicks ÷ impressions" />
        <Stat label="Leads" value={formatNumberIN(totals.leads)} />
        <Stat label="CPL" value={m.cpl ? formatINR(m.cpl) : "—"} hint="Spend ÷ leads" />
        <Stat label="ROAS" value={m.roas === null ? "—" : `${m.roas}x`} hint="Sales value ÷ spend" />
      </div>
      <EntriesPanel
        campaignId={id}
        readOnly={archived}
        today={todayKey()}
        entries={c.entries.map((e) => ({
          id: e.id,
          periodStart: dateOnlyKey(e.periodStart),
          periodEnd: dateOnlyKey(e.periodEnd),
          spend: e.spend.toString(),
          impressions: e.impressions,
          clicks: e.clicks,
          leads: e.leads,
          conversionValue: e.conversionValue.toString(),
          source: e.source,
        }))}
      />
    </div>
  );
}
