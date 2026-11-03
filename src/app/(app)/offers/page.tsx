import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/list-params";
import { statusDef } from "@/lib/status";
import { getOfferList } from "@/server/queries/offers";
import { expireOverdueOffers } from "@/server/services/offers";
import { OffersTable } from "./offers-table";

export const metadata: Metadata = { title: "Offers" };

export default async function OffersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("sales.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Offers"
        description="Your quotations, from draft to accepted."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/offers/templates"><LayoutTemplate /> Templates</Link></Button>
            <Button size="sm" asChild><Link href="/offers/new"><Plus /> New offer</Link></Button>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <OffersList sp={sp} />
      </Suspense>
    </div>
  );
}

async function OffersList({ sp }: { sp: SearchParams }) {
  // Offers past their validity show as Expired even if the daily job hasn't run yet.
  await expireOverdueOffers(db);
  const list = await getOfferList(sp);
  const filtered = ["q", "status", "attention", "view", "client", "lead"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search number, title, client…"
        exportHref="/api/export/offers"
        filters={[
          { key: "status", label: "Status", options: ["DRAFT", "SENT", "ON_HOLD", "ACCEPTED", "REJECTED", "EXPIRED"].map((s) => ({ value: s, label: statusDef("offer", s).label })) },
          { key: "attention", label: "Needs attention", options: [{ value: "followup", label: "Follow-up due" }, { value: "expiring", label: "Expiring in 7 days" }] },
          { key: "view", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <OffersTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} today={todayKey()} filtered={filtered} />
    </div>
  );
}
