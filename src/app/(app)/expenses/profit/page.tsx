import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RevenueExpenseChart } from "@/components/dashboard/charts";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { formatDateKey, formatMonthKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { param, type SearchParams } from "@/lib/list-params";
import { toNumber, type Decimal } from "@/lib/money/decimal";
import { formatINR } from "@/lib/money/format";
import { lastMonths, periodRange, PROFIT_PERIODS } from "@/lib/profit";
import { cn } from "@/lib/utils";
import { getNames } from "@/server/queries/expenses";
import { monthlyReport, profitReport } from "@/server/services/profit";

export const metadata: Metadata = { title: "Profitability" };

const inr = (v: Decimal) => (v.isZero() ? "—" : formatINR(v.toString(), { decimals: false }));

export default async function ProfitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const period = periodRange(param(await searchParams, "period"), todayKey());
  return (
    <div className="space-y-4">
      <PageHeader
        title="Profitability"
        description="Revenue before GST, less linked expenses and team time at each person's hourly cost."
        back={{ href: "/expenses", label: "Expenses" }}
        actions={<Button variant="outline" size="sm" asChild><a href={`/api/export/profit?period=${period.key}`}><Download /> Excel</a></Button>}
      />
      <Suspense fallback={<ListSkeleton />}>
        <Monthly />
      </Suspense>
      <nav aria-label="Period" className="flex flex-wrap gap-1.5">
        {PROFIT_PERIODS.map((p) => (
          <a key={p.key} href={`/expenses/profit?period=${p.key}`} aria-current={p.key === period.key ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent", p.key === period.key && "border-primary/40 bg-primary/10 font-medium")}>{p.label}</a>
        ))}
      </nav>
      <p className="text-xs text-muted-foreground">{period.from ? `${formatDateKey(period.from)} to ${formatDateKey(period.to)}` : `Everything up to ${formatDateKey(period.to)}`}</p>
      <Suspense key={period.key} fallback={<ListSkeleton />}>
        <Tables from={period.from} to={period.to} />
      </Suspense>
    </div>
  );
}

async function Monthly() {
  const rows = await monthlyReport(db, lastMonths(todayKey(), 12));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Agency revenue vs expenses</CardTitle>
          <CardDescription>Last 12 months, before GST. Expenses here include agency overheads. Team time isn&apos;t included.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <RevenueExpenseChart data={rows.map((r) => ({ month: formatMonthKey(r.month, true), revenue: toNumber(r.revenue), expenses: toNumber(r.expenses) }))} />
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">See the figures</summary>
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows].reverse().map((r) => (
                  <TableRow key={r.month}>
                    <TableCell className="whitespace-nowrap">{formatMonthKey(r.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.expenses)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.net.isNegative() && "text-tone-red")}>{inr(r.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

type Row = Awaited<ReturnType<typeof profitReport>>["clients"][number];

function ProfitTable({ title, description, rows, name }: { title: string; description?: string; rows: Row[]; name: (id: string) => { label: string; sub?: string; href: string } }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className="px-0 sm:px-5">
        {rows.length === 0 ? (
          <EmptyState title="Nothing in this period" hint="Try a longer period." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Team time</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const n = name(r.id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={n.href} className="block max-w-64 truncate font-medium hover:underline" title={n.label}>{n.label}</Link>
                      {n.sub && <div className="max-w-64 truncate text-xs text-muted-foreground">{n.sub}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.expenses)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.time)}</TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", r.profit.isNegative() && "text-tone-red")}>{inr(r.profit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.marginPercent === null ? "—" : `${r.marginPercent}%`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function Tables({ from, to }: { from: string | null; to: string }) {
  const report = await profitReport(db, from, to);
  const names = await getNames(report.clients.map((c) => c.id), report.projects.map((p) => p.id));
  return (
    <div className="space-y-4">
      <ProfitTable title="By client" description={`Agency overheads not linked to anyone: ${formatINR(report.overheads.toString(), { decimals: false })}. They aren't taken off any client's profit.`} rows={report.clients} name={(id) => ({ label: names.clients.get(id) ?? "—", href: `/clients/${id}?tab=expenses` })} />
      <ProfitTable title="By project" description="Only invoices and expenses linked to the project count here." rows={report.projects} name={(id) => ({ label: names.projects.get(id)?.name ?? "—", sub: names.projects.get(id)?.client, href: `/projects/${id}` })} />
    </div>
  );
}
