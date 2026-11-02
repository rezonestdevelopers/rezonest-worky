"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { addDaysKey, formatDateKey, daysBetweenKeys } from "@/lib/dates";
import type { DeadlineItem } from "@/server/queries/dashboard/data";
import { CalendarCheck } from "lucide-react";

export function Deadlines({ items, todayKey }: { items: DeadlineItem[]; todayKey: string }) {
  const [days, setDays] = useState("7");
  const limit = addDaysKey(todayKey, Number(days));
  const visible = items.filter((i) => i.date <= limit);
  const groups = new Map<string, DeadlineItem[]>();
  for (const i of visible) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);

  const relative = (d: string) => {
    const n = daysBetweenKeys(todayKey, d);
    return n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`;
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div>
          <CardTitle>Upcoming deadlines</CardTitle>
          <CardDescription>Deadlines, milestones, renewals, invoices &amp; urgent tasks</CardDescription>
        </div>
        <Tabs value={days} onValueChange={setDays}>
          <TabsList className="h-8">
            <TabsTrigger value="7" className="text-xs">7 days</TabsTrigger>
            <TabsTrigger value="30" className="text-xs">30 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="max-h-[480px] flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState title="Nothing due" hint={`No deadlines in the next ${days} days.`} icon={CalendarCheck} />
        ) : (
          <ol className="relative space-y-4 border-l pl-4">
            {Array.from(groups.entries()).map(([date, list]) => (
              <li key={date}>
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card-solid bg-primary" aria-hidden />
                <div className="mb-1.5 text-xs font-medium">
                  {formatDateKey(date)} <span className="font-normal text-muted-foreground">· {relative(date)}</span>
                </div>
                <ul className="space-y-1.5">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link href={i.href} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                        <Badge tone={i.tone} className="mt-0.5">{i.type}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{i.title}</div>
                          {i.client && <div className="truncate text-xs text-muted-foreground">{i.client}</div>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
