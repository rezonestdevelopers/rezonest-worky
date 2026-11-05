"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { markNotificationsReadAction } from "@/server/actions/notifications";

export type BellItem = { id: string; title: string; body: string | null; href: string | null; when: string };

/** The number is unread notifications plus reminders that need attention. */
export function NotificationBell({ reminders, unread, items }: { reminders: number; unread: number; items: BellItem[] }) {
  const [, start] = useTransition();
  const count = reminders + unread;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${count ? ` (${count} need attention)` : ""}`}>
          <Bell />
          {count > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        {reminders > 0 && (
          <DropdownMenuItem asChild>
            <Link href="/notifications" className="font-medium">{reminders} reminder{reminders === 1 ? "" : "s"} need{reminders === 1 ? "s" : ""} attention</Link>
          </DropdownMenuItem>
        )}
        {items.length === 0 && reminders === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">Nothing new.</p>}
        {items.map((n) => (
          <DropdownMenuItem key={n.id} asChild>
            <Link href={n.href ?? "/notifications?tab=inbox"} onClick={() => start(() => markNotificationsReadAction(n.id))} className="flex-col items-start gap-0.5">
              <span className="font-medium">{n.title}</span>
              {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{n.when}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        {items.length > 0 && <DropdownMenuItem onSelect={() => start(() => markNotificationsReadAction())}>Mark all as read</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications">See all reminders and notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
