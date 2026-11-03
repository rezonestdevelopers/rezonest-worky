"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/server/queries/leads";

export function LeadsTable({
  rows, total, page, pageSize, sort, dir, today, filtered,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  today: string;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<LeadRow>[]>(
    () => [
      {
        id: "contactName",
        accessorKey: "contactName",
        header: "Contact",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={`/leads/${row.original.id}`} className="font-medium hover:underline">{row.original.contactName}</Link>
        ),
      },
      { id: "companyName", accessorKey: "companyName", header: "Company", enableSorting: true, cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "phone", accessorKey: "phone", header: "Phone", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "email", accessorKey: "email", header: "Email", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "city", accessorKey: "city", header: "City", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "sector", accessorKey: "sector", header: "Sector", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "source", accessorKey: "source", header: "Source", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
      { id: "stage", accessorKey: "stage", header: "Stage", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="lead" value={getValue() as string} /> },
      {
        id: "approxBudget",
        accessorKey: "approxBudget",
        header: "Budget",
        enableSorting: true,
        cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatINR(getValue() as string, { decimals: false }) : "—"}</span>,
      },
      {
        id: "nextFollowUpDate",
        accessorKey: "nextFollowUpDate",
        header: "Follow-up",
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.nextFollowUpDate;
          const open = row.original.stage !== "WON" && row.original.stage !== "LOST";
          return <span className={cn("tabular-nums", v && open && v <= today && "font-medium text-tone-red")}>{formatDateKey(v)}</span>;
        },
      },
      { id: "owner", accessorKey: "owner", header: "Owner", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
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
      noun="lead"
      hiddenByDefault={["email", "sector", "owner"]}
      emptyTitle={filtered ? "No leads match" : "No leads yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Add your first enquiry with “New lead”, or import a list from Excel."}
    />
  );
}
