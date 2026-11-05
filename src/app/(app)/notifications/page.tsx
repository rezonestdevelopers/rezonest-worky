import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { ALERT_CATEGORIES, MONEY_TYPES, typesOfCategory } from "@/lib/alerts";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { param, type SearchParams } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { getNotificationList, getReminderList } from "@/server/queries/reminders";
import { syncReminders } from "@/server/services/reminders";
import { loadViewer, type Viewer } from "@/server/services/tasks";
import { InboxTable } from "./inbox-table";
import { RemindersTable } from "./reminders-table";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const viewer = await loadViewer(db, user);
  const tab = param(sp, "tab") === "inbox" ? "inbox" : "reminders";
  const tabs = [
    { key: "reminders", label: "Reminders", href: "/notifications" },
    { key: "inbox", label: "Notifications", href: "/notifications?tab=inbox" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Reminders & notifications" description={viewer.role === "EMPLOYEE" ? "Your tasks that need attention, and what's been sent to you." : "Everything that needs attention today, and what's been sent to you."} />
      <nav aria-label="Sections" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === tab ? "page" : undefined} className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", t.key === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Suspense key={tab} fallback={<ListSkeleton />}>
        {tab === "reminders" ? <Reminders sp={sp} viewer={viewer} /> : <Inbox sp={sp} userId={user.id} />}
      </Suspense>
    </div>
  );
}

async function Reminders({ sp, viewer }: { sp: SearchParams; viewer: Viewer }) {
  // Always current here: finishing a task should clear its reminder straight away.
  await syncReminders(db);
  const list = await getReminderList(sp, viewer);
  const show = param(sp, "show");
  const categories = Object.entries(ALERT_CATEGORIES).filter(([key]) => {
    const types = typesOfCategory(key);
    if (viewer.role === "EMPLOYEE") return key === "overdue" || key === "due_today" || key === "due_soon" || key === "approval";
    return viewer.role === "ADMIN" || !types.every((t) => MONEY_TYPES.includes(t));
  });
  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search reminders…"
        exportHref="/api/export/reminders"
        filters={[
          { key: "show", label: "Showing", allLabel: "Open", options: [{ value: "snoozed", label: "Snoozed" }, { value: "done", label: "Done" }] },
          { key: "category", label: "Type", options: categories.map(([value, label]) => ({ value, label })) },
          { key: "severity", label: "Urgency", options: [{ value: "CRITICAL", label: "Critical" }, { value: "WARNING", label: "Warning" }, { value: "INFO", label: "For information" }] },
        ]}
      />
      <RemindersTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} show={show === "snoozed" || show === "done" ? show : "open"} filtered={["q", "category", "severity", "show"].some((k) => sp[k])} />
    </div>
  );
}

async function Inbox({ sp, userId }: { sp: SearchParams; userId: string }) {
  const list = await getNotificationList(sp, userId);
  return (
    <div className="space-y-4">
      <ListToolbar placeholder="Search notifications…" keep={["tab"]} filters={[{ key: "show", label: "Showing", options: [{ value: "unread", label: "Unread" }] }]} />
      <InboxTable rows={list.rows} total={list.total} unread={list.unread} page={list.page} pageSize={list.pageSize} filtered={["q", "show"].some((k) => sp[k])} />
    </div>
  );
}
