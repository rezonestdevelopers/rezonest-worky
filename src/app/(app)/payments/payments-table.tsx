"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { paymentModeLabel } from "@/lib/invoice-rules";
import type { PaymentRow } from "@/server/queries/invoices";

export function PaymentsTable({ rows, total, page, pageSize, sort, dir, filtered }: { rows: PaymentRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; filtered: boolean }) {
  const columns = useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        header: "Date",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-64">
            <Link href={`/payments/${row.original.id}`} className="block font-medium whitespace-nowrap tabular-nums hover:underline">{formatDateKey(row.original.date)}</Link>
            <div className="truncate text-xs text-muted-foreground" title={row.original.client}>{row.original.client}</div>
          </div>
        ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: "Amount",
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{formatINR(row.original.amount)}</span>
            {row.original.voided && <Badge tone="grey">Void</Badge>}
          </div>
        ),
      },
      { id: "tds", accessorKey: "tds", header: "TDS", cell: ({ row }) => <span className="tabular-nums">{Number(row.original.tds) > 0 ? `${formatINR(row.original.tds)}${row.original.tdsSection ? ` (${row.original.tdsSection})` : ""}` : "—"}</span> },
      { id: "mode", accessorKey: "mode", header: "Mode", cell: ({ getValue }) => paymentModeLabel(getValue() as string) },
      { id: "reference", accessorKey: "reference", header: "Reference", cell: ({ getValue }) => <span className="block max-w-40 truncate">{(getValue() as string | null) ?? "—"}</span> },
      { id: "invoices", accessorKey: "invoices", header: "Invoices", cell: ({ getValue }) => <span className="block max-w-56 truncate text-xs" title={getValue() as string}>{(getValue() as string) || "—"}</span> },
      { id: "advance", accessorKey: "advance", header: "Advance left", cell: ({ row }) => <span className="tabular-nums">{!row.original.voided && Number(row.original.advance) > 0 ? formatINR(row.original.advance) : "—"}</span> },
    ],
    [],
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
      noun="payment"
      emptyTitle={filtered ? "No payments match" : "No payments yet"}
      emptyHint={filtered ? "Try clearing a filter." : "Record the first one when money arrives."}
    />
  );
}
