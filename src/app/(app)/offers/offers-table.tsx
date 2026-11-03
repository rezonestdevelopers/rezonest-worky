"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { OfferRow } from "@/server/queries/offers";

export function OffersTable({
  rows, total, page, pageSize, sort, dir, today, filtered,
}: {
  rows: OfferRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  today: string;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<OfferRow>[]>(
    () => [
      {
        id: "number",
        accessorKey: "number",
        header: "Number",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={`/offers/${row.original.id}`} className="font-medium hover:underline">
            {row.original.number}
            {row.original.version > 1 && <span className="ml-1 text-xs text-muted-foreground">v{row.original.version}</span>}
          </Link>
        ),
      },
      { id: "title", accessorKey: "title", header: "Title", enableSorting: true, cell: ({ getValue }) => <span className="block max-w-64 truncate" title={getValue() as string}>{getValue() as string}</span> },
      {
        id: "recipient",
        accessorKey: "recipient",
        header: "For",
        cell: ({ row }) => (
          <span className="block max-w-52 truncate" title={row.original.recipient}>
            {row.original.recipient}
            {row.original.recipientKind === "Lead" && <span className="ml-1 text-xs text-muted-foreground">(lead)</span>}
          </span>
        ),
      },
      { id: "status", accessorKey: "status", header: "Status", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="offer" value={getValue() as string} /> },
      { id: "taxableTotal", accessorKey: "taxableTotal", header: "Value excl. GST", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string, { decimals: false })}</span> },
      { id: "offerDate", accessorKey: "offerDate", header: "Date", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatDateKey(getValue() as string)}</span> },
      { id: "validUntil", accessorKey: "validUntil", header: "Valid until", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatDateKey(getValue() as string)}</span> },
      {
        id: "followUpDate",
        accessorKey: "followUpDate",
        header: "Follow-up",
        enableSorting: true,
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return <span className={cn("tabular-nums", v && v <= today && "font-medium text-tone-red")}>{formatDateKey(v)}</span>;
        },
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
      noun="offer"
      emptyTitle={filtered ? "No offers match" : "No offers yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Create your first quotation with “New offer”."}
    />
  );
}
