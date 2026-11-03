"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type VisibilityState,
} from "@tanstack/react-table";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PAGE_SIZES } from "@/lib/list-params";

/**
 * Table for long lists. The server does the searching, sorting and paging, and the
 * current view lives in the URL, so only one page of records reaches the browser and
 * the back button and shared links work. To make a column sortable, set
 * `enableSorting: true` and give it an id the query accepts.
 */
export function DataTable<T extends RowData>({
  columns,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  hiddenByDefault = [],
  emptyTitle,
  emptyHint,
  noun,
}: {
  columns: ColumnDef<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  hiddenByDefault?: string[];
  emptyTitle: string;
  emptyHint?: string;
  noun: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<VisibilityState>(Object.fromEntries(hiddenByDefault.map((c) => [c, false])));

  const setParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableSorting: false,
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {total.toLocaleString("en-IN")} {noun}{total === 1 ? "" : "s"}
          {pending && <Loader2 className="size-3.5 animate-spin" aria-label="Updating" />}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm"><Columns3 /> Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
              <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        <div className="glass rounded-xl border">
          <EmptyState title={emptyTitle} hint={emptyHint} className="py-14" />
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => {
                    const sortable = header.column.columnDef.enableSorting === true;
                    const active = sortable && sort === header.column.id;
                    return (
                      <TableHead key={header.id} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                        {sortable ? (
                          <button
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => setParams({ sort: header.column.id, dir: active && dir === "asc" ? "desc" : "asc", page: "1" })}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {active ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
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

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {first.toLocaleString("en-IN")}–{Math.min(total, page * pageSize).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </span>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => setParams({ size: v, page: "1" })}>
            <SelectTrigger size="sm" aria-label="Rows per page"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} per page</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="tabular-nums">Page {page} of {pages}</span>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })} aria-label="Previous page"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) })} aria-label="Next page"><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
