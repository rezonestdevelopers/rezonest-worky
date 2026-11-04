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
import { todayKey } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { formatINR } from "@/lib/money/format";
import { ASSET_KINDS, assetKindLabel } from "@/lib/renewals";
import { cn } from "@/lib/utils";
import { getAssetClients, getRenewalList, getRenewalSummary } from "@/server/queries/renewals";
import { RenewalsTable } from "./renewals-table";

export const metadata: Metadata = { title: "Renewals" };

const Stat = ({ label, value, tone, href }: { label: string; value: string | number; tone?: string; href?: string }) => {
  const body = (
    <Card className="gap-1 py-4 transition-colors hover:bg-accent/40">
      <CardContent className="px-4">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>{value}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} scroll={false}>{body}</Link> : body;
};

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Renewals"
        description="Every client's domains, hosting, SSL and business email, nearest expiry first. Passwords are never stored here."
        actions={<Button size="sm" asChild><Link href="/renewals/new"><Plus /> Add item</Link></Button>}
      />
      <Suspense fallback={<ListSkeleton />}>
        <RenewalsList sp={sp} />
      </Suspense>
    </div>
  );
}

async function RenewalsList({ sp }: { sp: SearchParams }) {
  const [list, clients, summary] = await Promise.all([getRenewalList(sp), getAssetClients(), getRenewalSummary()]);
  const filtered = ["q", "kind", "within", "client", "show"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Expired" value={summary.expired} tone={summary.expired ? "text-tone-red" : undefined} href="/renewals?within=expired" />
        <Stat label="Within 7 days" value={summary.week} tone={summary.week ? "text-tone-red" : undefined} href="/renewals?within=7" />
        <Stat label="Within 30 days" value={summary.month} tone={summary.month ? "text-tone-amber" : undefined} href="/renewals?within=30" />
        <Stat label="Yearly margin if all renew" value={formatINR(summary.margin, { decimals: false })} />
      </div>
      <ListToolbar
        placeholder="Search name, provider, client…"
        exportHref="/api/export/renewals"
        filters={[
          { key: "within", label: "Expiry", options: [{ value: "expired", label: "Expired" }, { value: "7", label: "Within 7 days" }, { value: "15", label: "Within 15 days" }, { value: "30", label: "Within 30 days" }, { value: "90", label: "Within 90 days" }] },
          { key: "kind", label: "Type", options: ASSET_KINDS.map((k) => ({ value: k, label: assetKindLabel(k) })) },
          { key: "client", label: "Client", options: clients.map((c) => ({ value: c.id, label: c.companyName })) },
          { key: "show", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <RenewalsTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} today={todayKey()} filtered={filtered} />
    </div>
  );
}
