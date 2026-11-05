"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Paperclip } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { expenseCategoryLabel } from "@/lib/profit";
import type { ExpenseRow } from "@/server/queries/expenses";

export function ExpensesTable({ rows, total, page, pageSize, sort, dir, filtered }: { rows: ExpenseRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; filtered: boolean }) {
  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      { id: "date", accessorKey: "date", header: "Date", enableSorting: true, enableHiding: false, cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatDateKey(getValue() as string)}</span> },
      {
        id: "description",
        accessorKey: "description",
        header: "Expense",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-72">
            <Link href={`/expenses/${row.original.id}`} className="block truncate font-medium hover:underline" title={row.original.description}>{row.original.description}</Link>
            {row.original.vendor && <div className="truncate text-xs text-muted-foreground">{row.original.vendor}</div>}
          </div>
        ),
      },
      { id: "category", accessorKey: "category", header: "Category", enableSorting: true, cell: ({ getValue }) => <span className="whitespace-nowrap">{expenseCategoryLabel(getValue() as string)}</span> },
      {
        id: "link",
        header: "Client / project",
        cell: ({ row }) => (
          <div className="max-w-56 text-xs">
            {row.original.client ? <div className="truncate" title={row.original.client}>{row.original.client}</div> : <span className="text-muted-foreground">Agency overhead</span>}
            {row.original.project && <div className="truncate text-muted-foreground" title={row.original.project}>{row.original.project}</div>}
          </div>
        ),
      },
      { id: "amount", accessorKey: "amount", header: "Amount", enableSorting: true, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue() as string)}</span> },
      { id: "gstPaid", accessorKey: "gstPaid", header: "GST paid", cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue()) > 0 ? formatINR(getValue() as string) : "—"}</span> },
      { id: "bill", accessorKey: "hasBill", header: "Bill", cell: ({ getValue }) => (getValue() ? <Paperclip className="size-4 text-muted-foreground" aria-label="Bill attached" /> : "—") },
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
      noun="expense"
      emptyTitle={filtered ? "No expenses match" : "No expenses yet"}
      emptyHint={filtered ? "Try clearing a filter." : "Add one when you pay a freelancer, a tool or a bill."}
    />
  );
}
