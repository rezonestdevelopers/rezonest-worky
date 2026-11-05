"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { humanize } from "@/lib/status";
import type { InvoiceRow } from "@/server/queries/invoices";

export function InvoicesTable({ rows, total, page, pageSize, sort, dir, filtered }: { rows: InvoiceRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; filtered: boolean }) {
  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        id: "number",
        accessorKey: "number",
        header: "Invoice",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-64">
            <Link href={`/invoices/${row.original.id}`} className="block truncate font-medium whitespace-nowrap hover:underline">{row.original.number ?? "Draft"}</Link>
            <div className="truncate text-xs text-muted-foreground" title={row.original.client}>{row.original.client}</div>
          </div>
        ),
      },
      { id: "type", accessorKey: "type", header: "Type", cell: ({ getValue }) => humanize(getValue() as string) },
      { id: "status", accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge kind="invoice" value={getValue() as string} /> },
      {
        id: "payment",
        accessorKey: "paymentStatus",
        header: "Payment",
        cell: ({ row }) => (row.original.type === "TAX" && row.original.status === "ISSUED" ? <StatusBadge kind="payment" value={row.original.paymentStatus} /> : "—"),
      },
      { id: "invoiceDate", accessorKey: "invoiceDate", header: "Date", enableSorting: true, cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatDateKey(getValue() as string)}</span> },
      { id: "dueDate", accessorKey: "dueDate", header: "Due", enableSorting: true, cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatDateKey(getValue() as string)}</span> },
      { id: "grandTotal", accessorKey: "total", header: "Total", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string)}</span> },
      { id: "balanceDue", accessorKey: "balance", header: "Balance", enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{row.original.status === "ISSUED" && row.original.type === "TAX" ? formatINR(row.original.balance) : "—"}</span> },
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
      noun="invoice"
      emptyTitle={filtered ? "No invoices match" : "No invoices yet"}
      emptyHint={filtered ? "Try clearing a filter." : "Create one here, or from a project, milestone or renewal."}
    />
  );
}
