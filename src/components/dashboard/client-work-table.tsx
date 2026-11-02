"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatINR } from "@/lib/money/format";
import { formatDateKey } from "@/lib/dates";
import type { ClientWorkRow } from "@/server/queries/dashboard/data";
import { cn } from "@/lib/utils";

const HEALTH_ORDER = { DELAYED: 0, AT_RISK: 1, ON_TRACK: 2 } as const;
const PAY_ORDER = { OVERDUE: 0, PARTIALLY_PAID: 1, UNPAID: 2, PAID: 3, NONE: 4 } as const;
const ALL = "__all";

export function ClientWorkTable({ rows, showMoney, todayKey }: { rows: ClientWorkRow[]; showMoney: boolean; todayKey: string }) {
  const sp = useSearchParams();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "health", desc: false }]);
  const [visibility, setVisibility] = useState<VisibilityState>({ target: false, sector: false });
  const [health, setHealth] = useState(ALL);
  const [pay, setPay] = useState(ALL);

  const data = useMemo(
    () => rows.filter((r) => (health === ALL || r.health === health) && (pay === ALL || r.paymentStatus === pay)),
    [rows, health, pay],
  );

  const columns = useMemo<ColumnDef<ClientWorkRow>[]>(() => {
    const cols: ColumnDef<ClientWorkRow>[] = [
      {
        accessorKey: "client",
        header: "Client",
        cell: ({ row }) => (
          <Link href={`/clients/${row.original.id}`} className="font-medium hover:underline">
            {row.original.client}
          </Link>
        ),
      },
      { accessorKey: "sector", header: "Sector" },
      {
        id: "services",
        header: "Services",
        accessorFn: (r) => r.services.join(", "),
        cell: ({ row }) => (
          <div className="flex max-w-56 flex-wrap gap-1">
            {row.original.services.length ? row.original.services.map((s) => (
              <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{s}</span>
            )) : "—"}
          </div>
        ),
      },
      {
        accessorKey: "activeProject",
        header: "Active project",
        cell: ({ row }) => (
          <span className="block max-w-52 truncate" title={row.original.activeProject}>
            {row.original.activeProject}
            {row.original.projectCount > 1 && <span className="ml-1 text-xs text-muted-foreground">+{row.original.projectCount - 1}</span>}
          </span>
        ),
      },
      { accessorKey: "target", header: "Target" },
      {
        accessorKey: "deadline",
        header: "Deadline",
        sortUndefined: "last",
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return <span className={cn("tabular-nums", v && v < todayKey && "text-tone-red")}>{formatDateKey(v)}</span>;
        },
      },
      {
        accessorKey: "progress",
        header: "Progress",
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          if (v === null) return "—";
          return (
            <div className="flex w-24 items-center gap-2" title={`${v}%`}>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${v}%` }} />
              </div>
              <span className="w-8 text-right text-xs tabular-nums">{v}%</span>
            </div>
          );
        },
      },
      {
        accessorKey: "health",
        header: "Health",
        sortingFn: (a, b) => (HEALTH_ORDER[a.original.health ?? "ON_TRACK"] ?? 3) - (HEALTH_ORDER[b.original.health ?? "ON_TRACK"] ?? 3),
        cell: ({ getValue }) => (getValue() ? <StatusBadge kind="health" value={getValue() as string} /> : "—"),
      },
      {
        id: "team",
        header: "Team",
        accessorFn: (r) => r.team.join(", "),
        cell: ({ row }) => (
          <div className="flex -space-x-1.5">
            {row.original.team.slice(0, 4).map((n) => (
              <Tooltip key={n}>
                <TooltipTrigger asChild>
                  <span className="flex size-6 items-center justify-center rounded-full border-2 border-card-solid bg-secondary text-[10px] font-semibold">
                    {n.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{n}</TooltipContent>
              </Tooltip>
            ))}
            {row.original.team.length === 0 && <span className="text-muted-foreground">—</span>}
          </div>
        ),
      },
    ];
    if (showMoney) {
      cols.push(
        {
          accessorKey: "paymentStatus",
          header: "Payment",
          sortingFn: (a, b) => PAY_ORDER[a.original.paymentStatus] - PAY_ORDER[b.original.paymentStatus],
          cell: ({ getValue }) => <StatusBadge kind="payment" value={getValue() as string} />,
        },
        {
          accessorKey: "outstanding",
          header: () => <span className="block text-right">Outstanding</span>,
          cell: ({ getValue }) => <span className="block text-right tabular-nums">{(getValue() as number) > 0 ? formatINR(getValue() as number, { decimals: false }) : "—"}</span>,
        },
      );
    }
    cols.push({
      accessorKey: "nextAction",
      header: "Next action",
      cell: ({ row }) => (
        <div className="max-w-60">
          <div className="truncate" title={row.original.nextAction}>{row.original.nextAction}</div>
          {row.original.nextActionDate && (
            <div className={cn("text-xs text-muted-foreground tabular-nums", row.original.nextActionDate < todayKey && "text-tone-red")}>
              {formatDateKey(row.original.nextActionDate)}
            </div>
          )}
        </div>
      ),
    });
    return cols;
  }, [showMoney, todayKey]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const exportHref = `/api/export/client-work?${sp.toString()}`;
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start">
        <div>
          <CardTitle>Client work</CardTitle>
          <CardDescription>Every active client at a glance — sorted by health (most urgent first)</CardDescription>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-52">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => { setGlobalFilter(e.target.value); table.setPageIndex(0); }}
              placeholder="Search clients…"
              className="h-8 pl-8"
              aria-label="Search client work table"
            />
          </div>
          <Select value={health} onValueChange={(v) => { setHealth(v); table.setPageIndex(0); }}>
            <SelectTrigger size="sm" aria-label="Filter by health"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All health</SelectItem>
              <SelectItem value="DELAYED">Delayed</SelectItem>
              <SelectItem value="AT_RISK">At risk</SelectItem>
              <SelectItem value="ON_TRACK">On track</SelectItem>
            </SelectContent>
          </Select>
          {showMoney && (
            <Select value={pay} onValueChange={(v) => { setPay(v); table.setPageIndex(0); }}>
              <SelectTrigger size="sm" aria-label="Filter by payment status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All payments</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
                <SelectItem value="PARTIALLY_PAID">Partially paid</SelectItem>
                <SelectItem value="UNPAID">Unpaid</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Columns3 /> Columns</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {table.getAllLeafColumns().filter((c) => c.id !== "client").map((c) => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                  {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id === "outstanding" ? "Outstanding" : c.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download><Download /> Excel</a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 sm:px-5">
        {total === 0 ? (
          <EmptyState title="No clients match" hint="Try clearing the search or filters." />
        ) : (
          <div className="overflow-hidden border-y sm:rounded-lg sm:border">
            <Table>
              <TableHeader className="bg-muted/40">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      return (
                        <TableHead key={h.id} aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}>
                          {h.column.getCanSort() ? (
                            <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                            </button>
                          ) : (
                            flexRender(h.column.columnDef.header, h.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 px-5 text-xs text-muted-foreground sm:px-0">
          <span>
            {total ? `${pageIndex * pageSize + 1}–${Math.min(total, (pageIndex + 1) * pageSize)} of ${total}` : "0 clients"}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
