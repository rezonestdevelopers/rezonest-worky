"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Check, Clock, MoreHorizontal, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { updateAlertAction, type AlertActionInput } from "@/server/actions/alerts";
import type { ReminderRow } from "@/server/queries/reminders";

export function RemindersTable({ rows, total, page, pageSize, sort, dir, show, filtered }: { rows: ReminderRow[]; total: number; page: number; pageSize: number; sort: string; dir: "asc" | "desc"; show: "open" | "snoozed" | "done"; filtered: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState<ReminderRow | null>(null);
  const [days, setDays] = useState("7");

  const columns = useMemo<ColumnDef<ReminderRow>[]>(() => {
    const act = (r: ReminderRow, action: "done" | "snooze" | "reopen", snooze?: number) =>
      start(async () => {
        const input: AlertActionInput = { key: r.key, type: r.type as AlertActionInput["type"], title: r.title, entityType: r.entityType, entityId: r.entityId, href: r.href ?? undefined, action, days: snooze };
        const res = await updateAlertAction(input);
        if (res.ok) {
          toast.success(action === "done" ? "Marked as done" : action === "reopen" ? "Reopened" : `Snoozed for ${snooze} day${snooze === 1 ? "" : "s"}`);
          router.refresh();
        } else toast.error(res.error ?? "Something went wrong");
      });
    return [
      { id: "severity", accessorKey: "severity", header: "Urgency", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="severity" value={getValue() as string} /> },
      {
        id: "title",
        accessorKey: "title",
        header: "Reminder",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-xl min-w-56 whitespace-normal">
            {row.original.href ? <Link href={row.original.href} className="font-medium hover:underline">{row.original.title}</Link> : <span className="font-medium">{row.original.title}</span>}
            {row.original.detail && <div className="text-xs text-muted-foreground">{row.original.detail}</div>}
          </div>
        ),
      },
      { id: "category", accessorKey: "category", header: "Type" },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        header: show === "open" ? "Date" : show === "snoozed" ? "Back on" : "Closed",
        enableSorting: show === "open",
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{show === "snoozed" ? row.original.snoozedUntil : show === "done" ? row.original.resolvedAt : formatDateKey(row.original.dueDate)}</span>,
      },
      ...(show === "done" ? ([{ id: "how", header: "How", cell: ({ row }) => (row.original.doneManually ? "Marked done" : "Situation resolved") }] as ColumnDef<ReminderRow>[]) : []),
      {
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) =>
          show === "open" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Actions for ${row.original.title}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => act(row.original, "done")}><Check /> Mark done</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Snooze</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => act(row.original, "snooze", 1)}><Clock /> 1 day</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => act(row.original, "snooze", 3)}><Clock /> 3 days</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setDays("7"); setCustom(row.original); }}><Clock /> Custom…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (show === "snoozed" || row.original.doneManually) && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(row.original, "reopen")}><RotateCcw /> Reopen</Button>
          ),
      },
    ];
  }, [show, pending, router]);

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        noun="reminder"
        emptyTitle={filtered ? "Nothing matches" : "All clear"}
        emptyHint={filtered ? "Try clearing the search or filters." : "Nothing needs your attention right now."}
      />
      <Dialog open={!!custom} onOpenChange={(o) => !o && setCustom(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Snooze reminder</DialogTitle>
            <DialogDescription className="line-clamp-2">{custom?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="snoozeDays">Number of days (1 to 90)</Label>
            <Input id="snoozeDays" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustom(null)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() => {
                const n = Math.min(90, Math.max(1, Math.round(Number(days) || 1)));
                const r = custom;
                setCustom(null);
                if (!r) return;
                start(async () => {
                  const res = await updateAlertAction({ key: r.key, type: r.type as AlertActionInput["type"], title: r.title, entityType: r.entityType, entityId: r.entityId, href: r.href ?? undefined, action: "snooze", days: n });
                  if (res.ok) {
                    toast.success(`Snoozed for ${n} day${n === 1 ? "" : "s"}`);
                    router.refresh();
                  } else toast.error(res.error ?? "Something went wrong");
                });
              }}
            >
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
