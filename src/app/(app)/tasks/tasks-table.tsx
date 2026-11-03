"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TASK_STATUSES } from "@/lib/work-plan";
import { bulkUpdateTasksAction } from "@/server/actions/work";
import type { TaskRow } from "@/server/queries/tasks";

const NOBODY = "__nobody";
const text = ({ getValue }: { getValue: () => unknown }) => (getValue() as string | null) ?? "—";

export function TasksTable({
  rows, total, page, pageSize, sort, dir, today, filtered, canManage, people,
}: {
  rows: TaskRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  today: string;
  filtered: boolean;
  canManage: boolean;
  people: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const chosen = visibleIds.filter((id) => selected.has(id));

  const bulk = (change: { assigneeId?: string; status?: string }) =>
    start(async () => {
      const res = await bulkUpdateTasksAction({ taskIds: chosen, ...change });
      if (res.ok) {
        toast.success(res.message ?? "Updated");
        setSelected(new Set());
        router.refresh();
      } else toast.error(res.error);
    });

  const columns = useMemo<ColumnDef<TaskRow>[]>(() => {
    const cols: ColumnDef<TaskRow>[] = [];
    if (canManage) {
      cols.push({
        id: "select",
        enableHiding: false,
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all on this page"
            checked={visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))}
            onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.title}`}
            checked={selected.has(row.original.id)}
            onChange={(e) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(row.original.id);
                else next.delete(row.original.id);
                return next;
              })
            }
          />
        ),
      });
    }
    cols.push(
      {
        id: "title",
        accessorKey: "title",
        header: "Task",
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <Link href={`/tasks/${row.original.id}`} className="block max-w-80 truncate font-medium hover:underline" title={row.original.title}>{row.original.title}</Link>,
      },
      { id: "status", accessorKey: "status", header: "Status", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="task" value={getValue() as string} /> },
      { id: "priority", accessorKey: "priority", header: "Priority", enableSorting: true, cell: ({ getValue }) => <StatusBadge kind="priority" value={getValue() as string} /> },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        header: "Due",
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.dueDate;
          const late = v && v < today && row.original.status !== "DONE" && row.original.status !== "WAITING_CLIENT_APPROVAL";
          return <span className={cn("tabular-nums", late && "font-medium text-tone-red")}>{formatDateKey(v)}</span>;
        },
      },
      { id: "assignee", accessorKey: "assignee", header: "Assigned to", cell: ({ row }) => row.original.assignee ?? <span className="text-muted-foreground">{row.original.department ?? "—"}</span> },
      { id: "client", accessorKey: "client", header: "Client", cell: text },
      {
        id: "project",
        accessorKey: "project",
        header: "Project",
        cell: ({ row }) => (row.original.projectId ? <Link href={`/projects/${row.original.projectId}`} className="block max-w-56 truncate hover:underline">{row.original.project}</Link> : "—"),
      },
    );
    return cols;
  }, [canManage, selected, today, visibleIds]);

  return (
    <div className="space-y-3">
      {chosen.length > 0 && (
        <div className="glass sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm" role="toolbar" aria-label="Bulk actions">
          <span className="font-medium">{chosen.length} selected</span>
          <Select onValueChange={(v) => bulk({ assigneeId: v === NOBODY ? "" : v })} disabled={pending} value="">
            <SelectTrigger size="sm" aria-label="Reassign selected"><SelectValue placeholder="Reassign to…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>Nobody (department queue)</SelectItem>
              {people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => bulk({ status: v })} disabled={pending} value="">
            <SelectTrigger size="sm" aria-label="Change status of selected"><SelectValue placeholder="Change status…" /></SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.filter((s) => s !== "BLOCKED").map((s) => <SelectItem key={s} value={s}>{statusDef("task", s).label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        noun="task"
        hiddenByDefault={["project"]}
        emptyTitle={filtered ? "No tasks match" : "No open tasks"}
        emptyHint={filtered ? "Try clearing the search or filters." : "New tasks appear here when an offer becomes a project."}
      />
    </div>
  );
}
