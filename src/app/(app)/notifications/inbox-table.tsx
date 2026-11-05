"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction } from "@/server/actions/notifications";
import type { NotificationRow } from "@/server/queries/reminders";

export function InboxTable({ rows, total, unread, page, pageSize, filtered }: { rows: NotificationRow[]; total: number; unread: number; page: number; pageSize: number; filtered: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const read = (id?: string) =>
    start(async () => {
      await markNotificationsReadAction(id);
      router.refresh();
    });
  const columns = useMemo<ColumnDef<NotificationRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Notification",
        enableHiding: false,
        cell: ({ row }) => {
          const n = row.original;
          const label = <span className={cn("font-medium", !n.read && "text-primary")}>{!n.read && <span className="sr-only">Unread: </span>}{n.title}</span>;
          return (
            <div className="max-w-2xl min-w-56 whitespace-normal">
              {n.href ? <Link href={n.href} onClick={() => !n.read && read(n.id)} className="hover:underline">{label}</Link> : label}
              {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
            </div>
          );
        },
      },
      { id: "when", accessorKey: "when", header: "When", cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{getValue() as string}</span> },
      {
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => !row.original.read && <Button variant="ghost" size="sm" disabled={pending} onClick={() => read(row.original.id)}>Mark read</Button>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` only uses stable values
    [pending],
  );
  return (
    <div className="space-y-2">
      {unread > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => read()}><CheckCheck /> Mark all {unread} as read</Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort="createdAt"
        dir="desc"
        noun="notification"
        emptyTitle={filtered ? "Nothing matches" : "No notifications yet"}
        emptyHint={filtered ? "Try clearing the search or filters." : "You'll hear here when you're given a task, mentioned, or a client answers."}
      />
    </div>
  );
}
