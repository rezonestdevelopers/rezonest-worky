import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarDays, Columns3, List, Plus, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { monthKeyOf, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { param, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TASK_STATUSES } from "@/lib/work-plan";
import { getTaskBoard, getTaskCalendar, getTaskFormOptions, getTaskList } from "@/server/queries/tasks";
import { loadViewer, type Viewer } from "@/server/services/tasks";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TasksTable } from "./tasks-table";

export const metadata: Metadata = { title: "Tasks" };

function withParams(sp: SearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") next.set(k, v);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return `/tasks?${next.toString()}`;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("work.own");
  const sp = await searchParams;
  const canManage = can(user.role, "work.manage");
  const viewer = await loadViewer(db, user);
  const view = param(sp, "layout") ?? "list";
  const mine = param(sp, "mine") === "1";

  const tabs = [
    { key: "list", label: "List", icon: List },
    { key: "board", label: "Kanban", icon: Columns3 },
    { key: "calendar", label: "Calendar", icon: CalendarDays },
  ];
  const tabClass = (on: boolean) => cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors [&_svg]:size-4", on ? "bg-card-solid text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        description={canManage ? "All work across the agency." : "Your tasks and your department's."}
        actions={canManage && <Button size="sm" asChild><Link href="/tasks/new"><Plus /> New task</Link></Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Task views" className="inline-flex rounded-lg bg-muted p-1">
          {tabs.map((t) => (
            <Link key={t.key} href={withParams(sp, { layout: t.key === "list" ? null : t.key })} scroll={false} aria-current={t.key === view ? "page" : undefined} className={tabClass(t.key === view)}>
              <t.icon /> {t.label}
            </Link>
          ))}
        </nav>
        <Button variant={mine ? "default" : "outline"} size="sm" asChild>
          <Link href={withParams(sp, { mine: mine ? null : "1" })} scroll={false} aria-pressed={mine}><User /> My tasks</Link>
        </Button>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <TasksBody sp={sp} viewer={viewer} canManage={canManage} view={view} />
      </Suspense>
    </div>
  );
}

async function TasksBody({ sp, viewer, canManage, view }: { sp: SearchParams; viewer: Viewer; canManage: boolean; view: string }) {
  const options = await getTaskFormOptions();
  const today = todayKey();
  const filtered = ["q", "status", "priority", "assignee", "dept", "due", "project", "client", "mine", "show"].some((k) => sp[k]);

  const toolbar = (
    <ListToolbar
      placeholder="Search task, client, project…"
      exportHref="/api/export/tasks"
      keep={["layout", "month", "project", "mine"]}
      filters={[
        ...(view === "list" ? [{ key: "show", label: "Showing", allLabel: "Open tasks", options: [{ value: "all", label: "All tasks" }, { value: "archived", label: "Archived" }] }] : []),
        { key: "status", label: "Status", options: TASK_STATUSES.map((s) => ({ value: s, label: statusDef("task", s).label })) },
        { key: "due", label: "Due", options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "soon", label: "In the next 3 days" }, { value: "week", label: "In the next 7 days" }] },
        { key: "priority", label: "Priority", options: ["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => ({ value: p, label: statusDef("priority", p).label })) },
        ...(canManage
          ? [
              { key: "assignee", label: "Person", options: options.users },
              { key: "dept", label: "Department", options: options.departments },
            ]
          : []),
      ]}
    />
  );

  if (view === "board") {
    const board = await getTaskBoard(sp, viewer);
    return <div className="space-y-4">{toolbar}<TaskBoard rows={board.rows} today={today} truncated={board.truncated} limit={board.limit} /></div>;
  }
  if (view === "calendar") {
    const requested = param(sp, "month");
    const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : monthKeyOf(today);
    const rows = await getTaskCalendar(sp, viewer, month);
    return (
      <div className="space-y-4">
        {toolbar}
        <TaskCalendar month={month} rows={rows} today={today} makeHref={(m) => withParams(sp, { month: m })} />
      </div>
    );
  }
  const list = await getTaskList(sp, viewer);
  return (
    <div className="space-y-4">
      {toolbar}
      <TasksTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} today={today} filtered={filtered} canManage={canManage} people={canManage ? options.users : []} />
    </div>
  );
}
