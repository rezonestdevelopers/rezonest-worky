import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth-guard";
import { formatDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { statementPeriod } from "@/lib/invoice-rules";
import { param, type SearchParams } from "@/lib/list-params";
import { toDecimal, type DecimalLike } from "@/lib/money/decimal";
import { formatINR } from "@/lib/money/format";
import { clientLedger } from "@/server/services/payments";

export const metadata: Metadata = { title: "Statement of account" };

const bal = (v: DecimalLike) => (toDecimal(v).isNegative() ? `${formatINR(toDecimal(v).abs())} Cr` : formatINR(v));
const show = (v: DecimalLike) => (toDecimal(v).isZero() ? "" : formatINR(v));

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const sp = await searchParams;
  const client = await db.client.findUnique({ where: { id }, select: { id: true, companyName: true } });
  if (!client) notFound();
  const { from, to } = statementPeriod(param(sp, "from"), param(sp, "to"), todayKey());
  const ledger = await clientLedger(db, id, from, to);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Statement of account"
        description={client.companyName}
        back={{ href: `/clients/${id}?tab=invoices`, label: client.companyName }}
        actions={<Button variant="outline" size="sm" asChild><a href={`/api/clients/${id}/statement?from=${from}&to=${to}`} target="_blank" rel="noopener noreferrer"><Download /> PDF</a></Button>}
      />
      <Card>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
            <div className="space-y-1.5"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
            <Button type="submit" variant="outline">Show</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 px-0 sm:px-5">
          <div className="flex flex-wrap justify-between gap-2 px-5 text-sm sm:px-0">
            <span>Opening balance: <span className="font-medium tabular-nums">{bal(ledger.opening)}</span></span>
            <span>Closing balance: <span className="font-semibold tabular-nums" data-testid="closing-balance">{bal(ledger.closing)}</span></span>
          </div>
          {ledger.rows.length === 0 ? (
            <EmptyState title="Nothing in this period" hint="Try a wider date range." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDateKey(r.dateKey)}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.reference}</TableCell>
                      <TableCell className="max-w-72 truncate" title={r.description}>{r.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{show(r.debit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{show(r.credit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{bal(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold hover:bg-transparent">
                    <TableCell colSpan={3}>Totals</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(ledger.totalDebit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(ledger.totalCredit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{bal(ledger.closing)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <p className="px-5 text-xs text-muted-foreground sm:px-0">&quot;Cr&quot; means the client has paid in advance.</p>
          <p className="px-5 text-xs text-muted-foreground sm:px-0">Period: {formatDateKey(from)} to {formatDateKey(to)}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
