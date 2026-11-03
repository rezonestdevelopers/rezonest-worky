import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/list-params";
import { humanize } from "@/lib/status";
import { getTeamList } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("team.manage");
  const sp = await searchParams;
  const [rows, departments] = await Promise.all([
    getTeamList(sp),
    db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        description={<>Your people and how busy they are. Departments are in <Link href="/settings/lists" className="underline">Settings</Link>.</>}
        actions={<Button size="sm" asChild><Link href="/team/new"><Plus /> Add person</Link></Button>}
      />
      <ListToolbar
        placeholder="Search name or email…"
        filters={[
          { key: "dept", label: "Department", options: departments.map((d) => ({ value: d.id, label: d.name })) },
          { key: "show", label: "Showing", options: [{ value: "inactive", label: "Inactive" }] },
        ]}
      />
      {rows.length === 0 ? (
        <div className="glass rounded-xl border"><EmptyState title="Nobody matches" hint="Try clearing the search or filters." className="py-14" /></div>
      ) : (
        <div className="glass overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Department and role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Open tasks</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link href={`/team/${u.id}`} className="font-medium hover:underline">{u.name}</Link>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.employee?.department?.name ?? "—"}
                    {u.employee?.designation && <div className="text-xs text-muted-foreground">{u.employee.designation}</div>}
                  </TableCell>
                  <TableCell>{humanize(u.role)}</TableCell>
                  <TableCell className="tabular-nums"><Link href={`/tasks?assignee=${u.id}&open=1`} className="hover:underline">{u.open}</Link></TableCell>
                  <TableCell className={u.overdue ? "font-medium text-tone-red tabular-nums" : "tabular-nums"}>{u.overdue}</TableCell>
                  <TableCell>{formatDate(u.lastLoginAt)}</TableCell>
                  <TableCell>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
