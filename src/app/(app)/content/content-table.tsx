"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { platformLabel } from "@/lib/content-plan";
import { formatDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { labelForFormat } from "@/lib/work-plan";
import type { ContentRow } from "@/server/queries/content";

export function ContentTable({ rows, total, page, pageSize, sort, dir, today, filtered }: { rows: ContentRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; today: string; filtered: boolean }) {
  const columns = useMemo<ColumnDef<ContentRow>[]>(
    () => [
      {
        id: "topic",
        accessorKey: "topic",
        header: "Topic",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <Link href={`/content/${row.original.id}`} className="block max-w-72 truncate font-medium hover:underline" title={row.original.topic}>{row.original.topic}</Link>,
      },
      { id: "client", accessorKey: "client", header: "Client", cell: ({ getValue }) => <span className="block max-w-48 truncate">{getValue() as string}</span> },
      { id: "format", accessorKey: "format", header: "Format", cell: ({ getValue }) => labelForFormat(getValue() as string) },
      { id: "platforms", accessorKey: "platforms", header: "Platforms", cell: ({ row }) => <span className="block max-w-44 truncate">{row.original.platforms.map(platformLabel).join(", ") || "—"}</span> },
      {
        id: "publishDate",
        accessorKey: "publishDate",
        header: "Publish date",
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.publishDate;
          return <span className={cn("tabular-nums", v && v < today && !row.original.published && "font-medium text-tone-red")}>{formatDateKey(v)}</span>;
        },
      },
      { id: "designStatus", accessorKey: "designStatus", header: "Design", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="design" value={getValue() as string} /> },
      {
        id: "approvalStatus",
        accessorKey: "approvalStatus",
        header: "Approval",
        enableSorting: true,
        cell: ({ row }) => (row.original.published ? <Badge tone="blue">Published</Badge> : <StatusBadge kind="approval" value={row.original.approvalStatus} />),
      },
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
      noun="item"
      emptyTitle={filtered ? "No content matches" : "Nothing planned this month"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Monthly packages add their posts and reels here. You can also add content by hand."}
    />
  );
}
