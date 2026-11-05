import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PiggyBank, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import type { SearchParams } from "@/lib/list-params";
import { formatINR } from "@/lib/money/format";
import { EXPENSE_CATEGORIES, expenseCategoryLabel, PROFIT_PERIODS } from "@/lib/profit";
import { getExpenseFormOptions, getExpenseList, getExpenseSummary } from "@/server/queries/expenses";
import { ExpensesTable } from "./expenses-table";

export const metadata: Metadata = { title: "Expenses" };

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <Card className="gap-1 py-4">
    <CardContent className="px-4">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </CardContent>
  </Card>
);

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        description="What the agency spends. Link one to a client or project and it counts against their profit."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/expenses/profit"><PiggyBank /> Profitability</Link></Button>
            <Button size="sm" asChild><Link href="/expenses/new"><Plus /> Add expense</Link></Button>
          </div>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <ExpenseList sp={sp} />
      </Suspense>
    </div>
  );
}

async function ExpenseList({ sp }: { sp: SearchParams }) {
  const [list, options, summary] = await Promise.all([getExpenseList(sp), getExpenseFormOptions(), getExpenseSummary()]);
  const filtered = ["q", "category", "client", "link", "period", "show"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="This month, before GST" value={formatINR(summary.month, { decimals: false })} />
        <Stat label="GST paid this month" value={formatINR(summary.gst, { decimals: false })} />
        <Stat label="Last month, before GST" value={formatINR(summary.lastMonth, { decimals: false })} />
        <Stat label="This month, no bill yet" value={summary.noBill} />
      </div>
      <ListToolbar
        placeholder="Search description, paid to, client…"
        exportHref="/api/export/expenses"
        filters={[
          { key: "period", label: "Period", options: PROFIT_PERIODS.filter((p) => p.key !== "all").map((p) => ({ value: p.key, label: p.label })) },
          { key: "category", label: "Category", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: expenseCategoryLabel(c) })) },
          { key: "client", label: "Client", options: options.clients },
          { key: "link", label: "Linked to", options: [{ value: "overhead", label: "Agency overhead" }] },
          { key: "show", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <ExpensesTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} filtered={filtered} />
    </div>
  );
}
