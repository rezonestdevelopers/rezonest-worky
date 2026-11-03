"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatINR } from "@/lib/money/format";
import type { ClientRow } from "@/server/queries/clients";

const text = ({ getValue }: { getValue: () => unknown }) => (getValue() as string | null) ?? "—";

export function ClientsTable({
  rows, total, page, pageSize, sort, dir, showMoney, filtered,
}: {
  rows: ClientRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  showMoney: boolean;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<ClientRow>[]>(() => {
    const cols: ColumnDef<ClientRow>[] = [
      {
        id: "companyName",
        accessorKey: "companyName",
        header: "Client",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <Link href={`/clients/${row.original.id}`} className="font-medium hover:underline">{row.original.companyName}</Link>,
      },
      { id: "contact", accessorKey: "contact", header: "Contact", cell: text },
      { id: "phone", accessorKey: "phone", header: "Phone", cell: text },
      { id: "email", accessorKey: "email", header: "Email", cell: text },
      { id: "sector", accessorKey: "sector", header: "Sector", cell: text },
      { id: "city", accessorKey: "city", header: "City", enableSorting: true, cell: text },
      { id: "state", accessorKey: "state", header: "State", cell: text },
      { id: "gstin", accessorKey: "gstin", header: "GSTIN", cell: text },
      { id: "source", accessorKey: "source", header: "Source", cell: text },
      { id: "manager", accessorKey: "manager", header: "Account manager", cell: text },
      {
        id: "activeProjects",
        accessorKey: "activeProjects",
        header: "Active projects",
        cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span>,
      },
    ];
    if (showMoney) {
      cols.push({
        id: "outstanding",
        accessorKey: "outstanding",
        header: "Outstanding",
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return <span className="tabular-nums">{v && Number(v) > 0 ? formatINR(v, { decimals: false }) : "—"}</span>;
        },
      });
    }
    cols.push({ id: "status", accessorKey: "status", header: "Status", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="client" value={getValue() as string} /> });
    return cols;
  }, [showMoney]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      noun="client"
      hiddenByDefault={["email", "state", "gstin", "source"]}
      emptyTitle={filtered ? "No clients match" : "No clients yet"}
      emptyHint={filtered ? "Try clearing the search or filters." : "Add a client with “New client”, convert a lead, or import a list from Excel."}
    />
  );
}
