import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { formatDateKey, todayKey } from "@/lib/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { buildScope, getFilterOptions, parseFilters, PRESETS } from "@/server/queries/dashboard/filters";
import { getMyTasks } from "@/server/queries/dashboard/data";
import { db } from "@/lib/db";
import { runBackupIfDue } from "@/server/backup-job";
import { runDailyWorkIfStale } from "@/server/services/projects";
import { AlertsSection, ChartsGrid, ClientWorkSection, DeadlinesSection, KpiCards, Pipeline, TodayStrip } from "./sections";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;

  if (!can(user.role, "dashboard.full")) return <EmployeeDashboard userId={user.id} name={user.name} />;

  after(() => runDailyWorkIfStale(db));
  after(() => runBackupIfDue());
  const filters = parseFilters(sp);
  const [scope, options] = await Promise.all([buildScope(filters), getFilterOptions()]);
  const perms = { money: can(user.role, "dashboard.full"), profit: can(user.role, "dashboard.profit") };
  // re-mount streamed sections when filters change
  const k = JSON.stringify(filters);

  return (
    <div className="space-y-5">
      {sp.denied === "1" && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-tone-amber/30 bg-tone-amber/10 px-3 py-2 text-sm">
          <ShieldAlert className="size-4 text-tone-amber" /> You don&apos;t have access to that page.
        </div>
      )}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good {greeting()}, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateKey(filters.from)} – {formatDateKey(filters.to)} · {PRESETS[filters.preset]}
          </p>
        </div>
        <FiltersBar presets={PRESETS} preset={filters.preset} from={filters.from} to={filters.to} options={options} />
      </div>

      <Suspense key={`today-${k}`} fallback={<Skeleton className="h-[68px] w-full rounded-xl" />}>
        <TodayStrip scope={scope} perms={perms} />
      </Suspense>

      <Suspense key={`kpi-${k}`} fallback={<KpiSkeleton />}>
        <KpiCards scope={scope} perms={perms} />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Suspense key={`pipe-${k}`} fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <Pipeline scope={scope} perms={perms} />
          </Suspense>
        </div>
        <div className="min-w-0 xl:row-span-2">
          <Suspense key={`alerts-${k}`} fallback={<Skeleton className="h-[560px] w-full rounded-xl" />}>
            <AlertsSection scope={scope} perms={perms} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense key={`dl-${k}`} fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <DeadlinesSection scope={scope} perms={perms} />
          </Suspense>
        </div>
      </div>

      <Suspense key={`table-${k}`} fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <ClientWorkSection scope={scope} perms={perms} />
      </Suspense>

      <Suspense key={`charts-${k}`} fallback={<ChartsSkeleton />}>
        <ChartsGrid scope={scope} perms={perms} />
      </Suspense>
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-[118px] rounded-xl" />
      ))}
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-72 rounded-xl" />
      ))}
    </div>
  );
}

/** Employees see only their own tasks (brief §4). */
async function EmployeeDashboard({ userId, name }: { userId: string; name: string }) {
  const today = todayKey();
  const { overdue, today: dueToday, upcoming } = await getMyTasks(userId, today);
  const groups = [
    { title: "Overdue", list: overdue, empty: "Nothing overdue 🎉" },
    { title: "Due today", list: dueToday, empty: "Nothing due today" },
    { title: "Upcoming", list: upcoming.slice(0, 20), empty: "No upcoming tasks" },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {name.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">{formatDateKey(today)} · your tasks</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle>
                {g.title} <span className="ml-1 text-muted-foreground tabular-nums">{g.list.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {g.list.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{g.empty}</p>
              ) : (
                <ul className="divide-y">
                  {g.list.map((t) => (
                    <li key={t.id} className="py-2">
                      <Link href={`/tasks/${t.id}`} className="block hover:underline">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusBadge kind="task" value={t.status} />
                        <StatusBadge kind="priority" value={t.priority} />
                        <span>{t.client}</span>
                        <span className="tabular-nums">· {formatDateKey(t.dueKey)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
