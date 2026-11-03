import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money/format";
import { humanize } from "@/lib/status";

export const metadata: Metadata = { title: "Service catalogue" };

export default async function ServicesPage() {
  await requirePermission("settings.manage");
  const services = await db.service.findMany({
    orderBy: { sortOrder: "asc" },
    include: { department: { select: { name: true } }, _count: { select: { subServices: true, taskTemplates: true } } },
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Service catalogue"
        description="What you sell: default prices, GST, sub-services and the task templates used when work starts."
        actions={<Button size="sm" asChild><Link href="/settings/services/new"><Plus /> New service</Link></Button>}
      />
      {services.length === 0 ? (
        <div className="glass rounded-xl border"><EmptyState title="No services yet" hint="Add your first service to use it in offers." /></div>
      ) : (
        <div className="glass overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Service</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Default price</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>SAC</TableHead>
                <TableHead>Sub-services</TableHead>
                <TableHead>Templates</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link href={`/settings/services/${s.id}`} className="font-medium hover:underline">{s.name}</Link></TableCell>
                  <TableCell>{s.department?.name ?? "—"}</TableCell>
                  <TableCell>{humanize(s.billingType)}</TableCell>
                  <TableCell className="tabular-nums">{formatINR(s.defaultPrice, { decimals: false })} / {s.unit}</TableCell>
                  <TableCell className="tabular-nums">{s.gstRate.toString()}%</TableCell>
                  <TableCell>{s.sacCode ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{s._count.subServices}</TableCell>
                  <TableCell className="tabular-nums">{s._count.taskTemplates}</TableCell>
                  <TableCell>{s.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
