import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/list-params";
import { statusDef } from "@/lib/status";
import { CAMPAIGN_STATUSES } from "@/lib/validators/delivery";
import { getAdClients, getCampaignList } from "@/server/queries/ads";
import { CampaignsTable } from "./campaigns-table";

export const metadata: Metadata = { title: "Ads" };

export default async function AdsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("work.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Meta Ads"
        description="Campaigns you run on your clients' budgets. This is the client's money, so it never counts as your revenue."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/ads/import"><Upload /> Upload report</Link></Button>
            <Button size="sm" asChild><Link href="/ads/new"><Plus /> New campaign</Link></Button>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <AdsList sp={sp} />
      </Suspense>
    </div>
  );
}

async function AdsList({ sp }: { sp: SearchParams }) {
  const [list, clients, settings] = await Promise.all([getCampaignList(sp), getAdClients(), db.settings.findUnique({ where: { id: "agency" }, select: { adBudgetAlertPercent: true } })]);
  const filtered = ["q", "status", "client", "show"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search campaign, objective, client…"
        exportHref="/api/export/ads"
        filters={[
          { key: "status", label: "Status", options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: statusDef("campaign", s).label })) },
          { key: "client", label: "Client", options: clients.map((c) => ({ value: c.id, label: c.companyName })) },
          { key: "show", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <CampaignsTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} filtered={filtered} alertPercent={settings?.adBudgetAlertPercent ?? 85} />
    </div>
  );
}
