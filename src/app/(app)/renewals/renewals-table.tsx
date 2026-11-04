"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { daysBetweenKeys, formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { assetKindLabel, renewalUrgency } from "@/lib/renewals";
import type { RenewalRow } from "@/server/queries/renewals";

export function RenewalsTable({ rows, total, page, pageSize, sort, dir, today, filtered }: { rows: RenewalRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; today: string; filtered: boolean }) {
  const columns = useMemo<ColumnDef<RenewalRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Item",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-64">
            <Link href={`/renewals/${row.original.id}`} className="block truncate font-medium hover:underline" title={row.original.name}>{row.original.name}</Link>
            <div className="truncate text-xs text-muted-foreground">{row.original.client}</div>
          </div>
        ),
      },
      { id: "kind", accessorKey: "kind", header: "Type", enableSorting: true, cell: ({ getValue }) => assetKindLabel(getValue() as string) },
      { id: "provider", accessorKey: "provider", header: "Provider", cell: ({ row }) => <span className="block max-w-40 truncate">{row.original.provider ?? "—"}{row.original.plan ? ` · ${row.original.plan}` : ""}</span> },
      {
        id: "expiryDate",
        accessorKey: "expiryDate",
        header: "Expires",
        enableSorting: true,
        cell: ({ row }) => {
          const u = renewalUrgency(daysBetweenKeys(today, row.original.expiryDate));
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{formatDateKey(row.original.expiryDate)}</span>
              <Badge tone={u.tone}>{u.label}</Badge>
            </div>
          );
        },
      },
      { id: "autoRenew", accessorKey: "autoRenew", header: "Auto-renew", cell: ({ getValue }) => (getValue() ? "Yes" : "No") },
      { id: "cost", accessorKey: "cost", header: "Our cost", cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string, { decimals: false })}</span> },
      { id: "renewalPrice", accessorKey: "price", header: "Renewal price", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string, { decimals: false })}</span> },
      {
        id: "margin",
        accessorKey: "margin",
        header: "Margin",
        cell: ({ row }) => (
          <span className={Number(row.original.margin) < 0 ? "font-medium text-tone-red tabular-nums" : "tabular-nums"}>
            {formatINR(row.original.margin, { decimals: false })}{row.original.marginPercent !== null && <span className="ml-1 text-xs text-muted-foreground">({row.original.marginPercent}%)</span>}
          </span>
        ),
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
      hiddenByDefault={["autoRenew"]}
      emptyTitle={filtered ? "Nothing matches" : "Nothing tracked yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Add your clients' domains and hosting so renewals never get missed."}
    />
  );
}
