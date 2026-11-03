import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import type { SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";
import { getClientList } from "@/server/queries/clients";
import { getFormOptions } from "@/server/queries/options";
import { ClientsTable } from "./clients-table";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("sales.manage");
  const sp = await searchParams;
  const showMoney = can(user.role, "finance.manage");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        description="Everyone you work with. Open a client to see offers, projects, invoices and more."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/clients/import"><Upload /> Import</Link></Button>
            <Button size="sm" asChild><Link href="/clients/new"><Plus /> New client</Link></Button>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <ClientsList sp={sp} showMoney={showMoney} />
      </Suspense>
    </div>
  );
}

/**
 * Loads inside Suspense rather than a route loading.tsx: changing a filter must keep the
 * search box and current rows on screen until the new rows are ready.
 */
async function ClientsList({ sp, showMoney }: { sp: SearchParams; showMoney: boolean }) {
  const [list, options] = await Promise.all([getClientList(sp, showMoney), getFormOptions()]);
  const filtered = ["q", "status", "sector", "source", "manager"].some((k) => sp[k]);

  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search company, contact, phone, GSTIN…"
        exportHref="/api/export/clients"
        filters={[
          { key: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "ARCHIVED", label: "Archived" }] },
          { key: "sector", label: "Sector", options: options.sectors },
          { key: "source", label: "Source", options: options.sources },
          { key: "manager", label: "Manager", options: options.users },
        ]}
      />
      <ClientsTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sort={list.sort}
        dir={list.dir}
        showMoney={showMoney}
        filtered={filtered}
      />
    </div>
  );
}
