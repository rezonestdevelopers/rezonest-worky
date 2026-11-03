"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateKey } from "@/lib/dates";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskStatus } from "@/lib/work-plan";
import type { TaskRow } from "@/server/queries/tasks";
import { useTaskStatus } from "./task-status";

/**
 * Kanban: drag a card on a computer. On a phone or by keyboard, use the status menu on each card.
 * Those menus are the browser's own, because a board can hold hundreds of cards.
 */
export function TaskBoard({ rows, today, truncated, limit }: { rows: TaskRow[]; today: string; truncated: boolean; limit: number }) {
  const [over, setOver] = useState<TaskStatus | null>(null);
  const { change, dialog, pending } = useTaskStatus();

  return (
    <div className="space-y-2">
      {truncated && <p className="text-xs text-muted-foreground">Showing the first {limit} tasks. Use the filters to narrow this down.</p>}
      <div className="relative -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
        {TASK_STATUSES.map((status) => {
          const cards = rows.filter((r) => r.status === status);
          return (
            <section
              key={status}
              aria-label={statusDef("task", status).label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/task-id");
                const from = e.dataTransfer.getData("text/task-status");
                if (id && from !== status) change(id, status);
              }}
              className={cn("glass flex w-72 shrink-0 flex-col rounded-xl border p-2", over === status && "border-primary bg-primary/5")}
            >
              <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-medium">
                <StatusBadge kind="task" value={status} />
                <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
              </h2>
              <ul className="min-h-16 space-y-2">
                {cards.map((t) => {
                  const late = t.dueDate && t.dueDate < today && status !== "DONE" && status !== "WAITING_CLIENT_APPROVAL";
                  return (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/task-id", t.id);
                        e.dataTransfer.setData("text/task-status", status);
                      }}
                      className="space-y-2 rounded-lg border bg-card-solid p-2.5 text-sm shadow-xs"
                    >
                      <Link href={`/tasks/${t.id}`} className="line-clamp-2 font-medium hover:underline">{t.title}</Link>
                      <div className="text-xs text-muted-foreground">
                        <div className="truncate">{t.client ?? "No client"}</div>
                        <div className="truncate">{t.assignee ?? t.department ?? "Unassigned"}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <StatusBadge kind="priority" value={t.priority} />
                        <span className={cn("tabular-nums", late ? "font-medium text-tone-red" : "text-muted-foreground")}>{formatDateKey(t.dueDate)}</span>
                      </div>
                      <select
                        aria-label={`Status of ${t.title}`}
                        value={t.status}
                        disabled={pending}
                        onChange={(e) => change(t.id, e.target.value as TaskStatus)}
                        className="h-8 w-full rounded-md border border-input bg-card-solid px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:scheme-dark"
                      >
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{statusDef("task", s).label}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
