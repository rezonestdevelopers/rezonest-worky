import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { addDaysKey, formatDateKey, formatMonthKey, monthRange, shiftMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TaskRow } from "@/server/queries/tasks";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TONE: Record<string, string> = {
  DONE: "border-tone-green/40 bg-tone-green/10",
  BLOCKED: "border-tone-red/40 bg-tone-red/10",
  WAITING_CLIENT_APPROVAL: "border-tone-violet/40 bg-tone-violet/10",
  IN_REVIEW: "border-tone-amber/40 bg-tone-amber/10",
  IN_PROGRESS: "border-tone-blue/40 bg-tone-blue/10",
  TODO: "bg-muted",
};

/** A month of tasks by due date. A grid on a computer, and a simple list of days on a phone. */
export function TaskCalendar({ month, rows, today, makeHref }: { month: string; rows: TaskRow[]; today: string; makeHref: (month: string) => string }) {
  const { start, end } = monthRange(`${month}-01`);
  const firstWeekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days: string[] = [];
  for (let k = start; k <= end; k = addDaysKey(k, 1)) days.push(k);
  const byDay = new Map<string, TaskRow[]>();
  for (const r of rows) if (r.dueDate) byDay.set(r.dueDate, [...(byDay.get(r.dueDate) ?? []), r]);

  const card = (t: TaskRow) => (
    <Link key={t.id} href={`/tasks/${t.id}`} title={t.title} className={cn("block truncate rounded border px-1.5 py-0.5 text-xs hover:underline", TONE[t.status] ?? "bg-muted")}>
      {t.title}
    </Link>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{formatMonthKey(month)}</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" asChild><Link href={makeHref(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft /></Link></Button>
          <Button variant="outline" size="icon-sm" asChild><Link href={makeHref(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight /></Link></Button>
        </div>
      </div>

      <div className="glass hidden overflow-hidden rounded-xl border md:block">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
          {DAY_NAMES.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstWeekday }).map((_, i) => <div key={i} className="min-h-24 border-r border-b bg-muted/20" />)}
          {days.map((k) => {
            const list = byDay.get(k) ?? [];
            return (
              <div key={k} className={cn("min-h-24 space-y-1 border-r border-b p-1", k === today && "bg-primary/5")}>
                <div className={cn("px-1 text-xs tabular-nums", k === today ? "font-semibold text-primary" : "text-muted-foreground")}>{Number(k.slice(8))}</div>
                {list.slice(0, 4).map(card)}
                {list.length > 4 && <div className="px-1 text-[11px] text-muted-foreground">+{list.length - 4} more</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <div className="glass rounded-xl border"><EmptyState title="No tasks due this month" /></div>}
        {days.filter((k) => byDay.has(k)).map((k) => (
          <div key={k} className="glass space-y-1 rounded-xl border p-3">
            <div className={cn("text-xs font-medium", k === today && "text-primary")}>{formatDateKey(k)}</div>
            {byDay.get(k)!.map(card)}
          </div>
        ))}
      </div>
    </div>
  );
}
