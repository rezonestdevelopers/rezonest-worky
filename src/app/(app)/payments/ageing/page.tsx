import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth-guard";
import { AGEING_BUCKETS, AGEING_LABEL } from "@/lib/invoice-rules";
import { formatINR } from "@/lib/money/format";
import { getAgeingReport } from "@/server/queries/invoices";

export const metadata: Metadata = { title: "Ageing report" };

const show = (v: { isZero(): boolean; toString(): string }) => (v.isZero() ? "—" : formatINR(v.toString(), { decimals: false }));

export default async function AgeingPage() {
  await requirePermission("finance.manage");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ageing report"
        description="What each client owes on issued tax invoices, by how many days past the due date."
        back={{ href: "/payments", label: "Payments" }}
        actions={<Button variant="outline" size="sm" asChild><a href="/api/export/ageing"><Download /> Excel</a></Button>}
      />
      <Suspense fallback={<ListSkeleton />}>
        <Report />
      </Suspense>
    </div>
  );
}

async function Report() {
  const { rows, totals, total, advance } = await getAgeingReport();
  if (!rows.length) return <Card><CardContent><EmptyState title="Nothing outstanding" hint="Every issued invoice has been paid." /></CardContent></Card>;
  return (
    <Card>
      <CardContent className="overflow-x-auto px-0 sm:px-5">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Client</TableHead>
              {AGEING_BUCKETS.map((b) => <TableHead key={b} className="text-right whitespace-nowrap">{AGEING_LABEL[b]}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Advance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.clientId}>
                <TableCell><Link href={`/clients/${r.clientId}/statement`} className="block max-w-60 truncate font-medium hover:underline" title={r.client}>{r.client}</Link></TableCell>
                {AGEING_BUCKETS.map((b) => <TableCell key={b} className="text-right tabular-nums">{show(r.buckets[b])}</TableCell>)}
                <TableCell className="text-right font-medium tabular-nums">{show(r.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{show(r.advance)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold hover:bg-transparent" data-testid="ageing-total">
              <TableCell>Total</TableCell>
              {AGEING_BUCKETS.map((b) => <TableCell key={b} className="text-right tabular-nums">{show(totals[b])}</TableCell>)}
              <TableCell className="text-right tabular-nums">{show(total)}</TableCell>
              <TableCell className="text-right tabular-nums">{show(advance)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
