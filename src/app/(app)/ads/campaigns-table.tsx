"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { formatINR, formatNumberIN } from "@/lib/money/format";
import type { CampaignRow } from "@/server/queries/ads";
import { BudgetBar } from "./budget-bar";

export function CampaignsTable({ rows, total, page, pageSize, sort, dir, filtered, alertPercent }: { rows: CampaignRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; filtered: boolean; alertPercent: number }) {
  const columns = useMemo<ColumnDef<CampaignRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Campaign",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-64">
            <Link href={`/ads/${row.original.id}`} className="block truncate font-medium hover:underline" title={row.original.name}>{row.original.name}</Link>
            <div className="truncate text-xs text-muted-foreground">{row.original.client}</div>
          </div>
        ),
      },
      { id: "status", accessorKey: "status", header: "Status", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="campaign" value={getValue() as string} /> },
      { id: "startDate", accessorKey: "startDate", header: "Dates", enableSorting: true, cell: ({ row }) => <span className="text-xs tabular-nums">{formatDateKey(row.original.startDate)}<br />{row.original.endDate ? `to ${formatDateKey(row.original.endDate)}` : "No end date"}</span> },
      { id: "plannedBudget", accessorKey: "budget", header: "Budget", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string, { decimals: false })}</span> },
      { id: "spend", accessorKey: "spend", header: "Spent", cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string, { decimals: false })}</span> },
      { id: "utilisation", accessorKey: "utilisation", header: "Used", cell: ({ row }) => <BudgetBar utilisation={row.original.utilisation} alertPercent={alertPercent} className="w-28" /> },
      { id: "impressions", accessorKey: "impressions", header: "Impressions", cell: ({ getValue }) => <span className="tabular-nums">{formatNumberIN(getValue() as number)}</span> },
      { id: "clicks", accessorKey: "clicks", header: "Clicks", cell: ({ getValue }) => <span className="tabular-nums">{formatNumberIN(getValue() as number)}</span> },
      { id: "ctr", accessorKey: "ctr", header: "CTR", cell: ({ getValue }) => <span className="tabular-nums">{getValue() === null ? "—" : `${getValue() as number}%`}</span> },
      { id: "leads", accessorKey: "leads", header: "Leads", cell: ({ getValue }) => <span className="tabular-nums">{formatNumberIN(getValue() as number)}</span> },
      { id: "cpl", accessorKey: "cpl", header: "CPL", cell: ({ getValue }) => <span className="tabular-nums">{getValue() === null ? "—" : formatINR(getValue() as string, { decimals: false })}</span> },
      { id: "roas", accessorKey: "roas", header: "ROAS", cell: ({ getValue }) => <span className="tabular-nums">{getValue() === null ? "—" : `${getValue() as number}x`}</span> },
    ],
    [alertPercent],
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
      noun="campaign"
      hiddenByDefault={["impressions", "clicks"]}
      emptyTitle={filtered ? "No campaigns match" : "No campaigns yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Add a campaign, then enter its results or upload a report from Ads Manager."}
    />
  );
}
