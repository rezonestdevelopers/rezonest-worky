import { MonthCalendar } from "@/components/shared/month-calendar";
import type { TaskRow } from "@/server/queries/tasks";

const TONE: Record<string, string> = {
  DONE: "border-tone-green/40 bg-tone-green/10",
  BLOCKED: "border-tone-red/40 bg-tone-red/10",
  WAITING_CLIENT_APPROVAL: "border-tone-violet/40 bg-tone-violet/10",
  IN_REVIEW: "border-tone-amber/40 bg-tone-amber/10",
  IN_PROGRESS: "border-tone-blue/40 bg-tone-blue/10",
  TODO: "bg-muted",
};

/** A month of tasks by due date. */
export function TaskCalendar({ month, rows, today, makeHref }: { month: string; rows: TaskRow[]; today: string; makeHref: (month: string) => string }) {
  return (
    <MonthCalendar
      month={month}
      today={today}
      makeHref={makeHref}
      emptyTitle="No tasks due this month"
      entries={rows.map((t) => ({ id: t.id, dateKey: t.dueDate, title: t.title, href: `/tasks/${t.id}`, className: TONE[t.status] }))}
    />
  );
}
