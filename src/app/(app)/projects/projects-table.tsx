"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/server/queries/projects";

export function ProjectsTable({
  rows, total, page, pageSize, sort, dir, today, filtered,
}: {
  rows: ProjectRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  today: string;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Project",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={`/projects/${row.original.id}`} className="block max-w-64 truncate font-medium hover:underline" title={row.original.name}>{row.original.name}</Link>
        ),
      },
      { id: "code", accessorKey: "code", header: "Code", enableSorting: true },
      { id: "client", accessorKey: "client", header: "Client", cell: ({ getValue }) => <span className="block max-w-44 truncate" title={getValue() as string}>{getValue() as string}</span> },
      { id: "type", accessorKey: "type", header: "Type" },
      { id: "status", accessorKey: "status", header: "Status", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="project" value={getValue() as string} /> },
      { id: "health", accessorKey: "health", header: "Health", cell: ({ getValue }) => <StatusBadge kind="health" value={getValue() as string} /> },
      {
        id: "progressPercent",
        accessorKey: "progress",
        header: "Progress",
        enableSorting: true,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <div className="flex w-24 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${v}%`, background: "var(--chart-1)" }} /></div>
              <span className="w-8 text-right text-xs tabular-nums">{v}%</span>
            </div>
          );
        },
      },
      {
        id: "deadline",
        accessorKey: "deadline",
        header: "Deadline / ends",
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.deadline;
          const late = v && v < today && (row.original.status === "ACTIVE" || row.original.status === "ON_HOLD");
          return <span className={cn("tabular-nums", late && "font-medium text-tone-red")}>{formatDateKey(v)}</span>;
        },
      },
      { id: "manager", accessorKey: "manager", header: "Manager", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "openTasks", accessorKey: "openTasks", header: "Open tasks", cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    ],
    [today],
  );
  return (
    <DataTable
      columns={columns}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      noun="project"
      hiddenByDefault={["code", "type", "openTasks"]}
      emptyTitle={filtered ? "No projects match" : "No projects yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Projects start from an accepted offer, using “Convert to project”."}
    />
  );
}
