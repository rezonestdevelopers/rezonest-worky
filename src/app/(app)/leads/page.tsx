import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { LEAD_STAGES } from "@/lib/lead-stage";
import type { SearchParams } from "@/lib/list-params";
import { statusDef } from "@/lib/status";
import { getLeadList } from "@/server/queries/leads";
import { getFormOptions } from "@/server/queries/options";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("sales.manage");
  const sp = await searchParams;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description="Every enquiry, from first contact to won or lost."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/leads/import"><Upload /> Import</Link></Button>
            <Button size="sm" asChild><Link href="/leads/new"><Plus /> New lead</Link></Button>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <LeadsList sp={sp} />
      </Suspense>
    </div>
  );
}

/**
 * Loads inside Suspense rather than a route loading.tsx: changing a filter must keep the
 * search box and current rows on screen until the new rows are ready.
 */
async function LeadsList({ sp }: { sp: SearchParams }) {
  const [list, options] = await Promise.all([getLeadList(sp), getFormOptions()]);
  const filtered = ["q", "stage", "sector", "source", "owner", "followup", "view"].some((k) => sp[k]);

  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search name, company, phone…"
        exportHref="/api/export/leads"
        filters={[
          { key: "stage", label: "Stage", options: LEAD_STAGES.map((s) => ({ value: s, label: statusDef("lead", s).label })) },
          { key: "followup", label: "Follow-up", options: [{ value: "due", label: "Due or overdue" }] },
          { key: "sector", label: "Sector", options: options.sectors },
          { key: "source", label: "Source", options: options.sources },
          { key: "owner", label: "Owner", options: options.users },
          { key: "view", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <LeadsTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sort={list.sort}
        dir={list.dir}
        today={todayKey()}
        filtered={filtered}
      />
    </div>
  );
}
