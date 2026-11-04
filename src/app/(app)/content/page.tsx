import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarDays, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { MonthCalendar } from "@/components/shared/month-calendar";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { APPROVAL_STATUSES, CONTENT_FORMATS, DESIGN_STATUSES } from "@/lib/content-plan";
import { formatDateTime, formatMonthKey, monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { labelForFormat } from "@/lib/work-plan";
import { getContentCalendar, getContentClients, getContentList, getCurrentContentLink, getDeliverySummary } from "@/server/queries/content";
import { loadViewer, type Viewer } from "@/server/services/tasks";
import { ApprovalLinkPanel } from "./approval-link-panel";
import { ContentTable } from "./content-table";

export const metadata: Metadata = { title: "Content Calendar" };

const APPROVAL_TONE: Record<string, string> = {
  APPROVED: "border-tone-green/40 bg-tone-green/10",
  CHANGES_REQUESTED: "border-tone-red/40 bg-tone-red/10",
  PENDING: "border-tone-amber/40 bg-tone-amber/10",
};

function withParams(sp: SearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") next.set(k, v);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return `/content?${next.toString()}`;
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("work.own");
  const sp = await searchParams;
  const canManage = can(user.role, "work.manage");
  const viewer = await loadViewer(db, user);
  const view = param(sp, "layout") === "list" ? "list" : "calendar";
  const requested = param(sp, "month");
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : monthKeyOf(todayKey());
  const clientId = idParam(sp, "client") ?? "";

  const tabClass = (on: boolean) => cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors [&_svg]:size-4", on ? "bg-card-solid text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Content Calendar"
        description={canManage ? "What's going out for each client, and whether they've approved it." : "Content for the projects you work on."}
        actions={canManage && <Button size="sm" asChild><Link href={`/content/new?month=${month}${clientId ? `&client=${clientId}` : ""}`}><Plus /> Add content</Link></Button>}
      />
      <nav aria-label="Calendar views" className="inline-flex rounded-lg bg-muted p-1">
        <a href={withParams(sp, { layout: null })} aria-current={view === "calendar" ? "page" : undefined} className={tabClass(view === "calendar")}><CalendarDays /> Calendar</a>
        <a href={withParams(sp, { layout: "list" })} aria-current={view === "list" ? "page" : undefined} className={tabClass(view === "list")}><List /> List</a>
      </nav>
      <Suspense fallback={<ListSkeleton />}>
        <ContentBody sp={sp} viewer={viewer} canManage={canManage} view={view} month={month} clientId={clientId} />
      </Suspense>
    </div>
  );
}

async function ContentBody({ sp, viewer, canManage, view, month, clientId }: { sp: SearchParams; viewer: Viewer; canManage: boolean; view: string; month: string; clientId: string }) {
  const today = todayKey();
  const [clients, delivery, link, contact, calendar, list] = await Promise.all([
    getContentClients(viewer),
    getDeliverySummary(month, viewer, clientId || null),
    canManage && clientId ? getCurrentContentLink(clientId, month) : null,
    canManage && clientId ? db.client.findUnique({ where: { id: clientId }, select: { email: true, companyName: true } }) : null,
    view === "calendar" ? getContentCalendar(sp, viewer, month) : null,
    view === "list" ? getContentList(sp, viewer, month) : null,
  ]);
  const filtered = ["q", "client", "format", "approval", "design", "show"].some((k) => sp[k]);
  const toolbar = (
    <ListToolbar
      placeholder="Search topic, caption, client…"
      exportHref="/api/export/content"
      keep={["layout", "month"]}
      filters={[
        { key: "client", label: "Client", options: clients.map((c) => ({ value: c.id, label: c.companyName })) },
        { key: "format", label: "Format", options: CONTENT_FORMATS.map((f) => ({ value: f, label: labelForFormat(f) })) },
        { key: "approval", label: "Approval", options: APPROVAL_STATUSES.map((s) => ({ value: s, label: statusDef("approval", s).label })) },
        { key: "design", label: "Design", options: DESIGN_STATUSES.map((s) => ({ value: s, label: statusDef("design", s).label })) },
        ...(canManage ? [{ key: "show", label: "Showing", options: [{ value: "archived", label: "Archived" }] }] : []),
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {toolbar}
      {canManage && (clientId ? (
        <ApprovalLinkPanel
          clientId={clientId}
          month={month}
          monthLabel={formatMonthKey(month)}
          clientName={contact?.companyName ?? ""}
          email={contact?.email ?? ""}
          link={link ? { id: link.id, views: link.viewCount, lastViewed: link.lastViewedAt ? formatDateTime(link.lastViewedAt) : null, expires: formatDateTime(link.expiresAt) } : null}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Choose a client above to send them this month&apos;s content for approval.</p>
      ))}
      {calendar && <CalendarView sp={sp} rows={calendar} month={month} today={today} />}
      {list && <ListView sp={sp} list={list} month={month} today={today} filtered={filtered} />}
      {delivery.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Committed vs delivered</CardTitle>
              <CardDescription>{formatMonthKey(month)}. Delivered means all of its tasks are done, or it&apos;s been published.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {delivery.map((d) => (
                <li key={d.clientId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <a href={withParams(sp, { client: d.clientId })} className="min-w-0 font-medium hover:underline">{d.client}</a>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="delivery-counts">
                    {d.formats.map((f) => (
                      <span key={f.format} className={cn("rounded-full border px-2.5 py-1 tabular-nums", f.delivered >= f.committed ? "border-tone-green/40 bg-tone-green/10" : "bg-card-solid")}>
                        {f.delivered}/{f.committed} {labelForFormat(f.format).toLowerCase()}s
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CalendarView({ sp, rows, month, today }: { sp: SearchParams; rows: Awaited<ReturnType<typeof getContentCalendar>>; month: string; today: string }) {
  return (
    <div className="space-y-2">
      <MonthCalendar
        month={month}
        today={today}
        makeHref={(m) => withParams(sp, { month: m })}
        emptyTitle="Nothing planned this month"
        entries={rows.map((r) => ({
          id: r.id,
          dateKey: r.publishDate,
          title: `${labelForFormat(r.format)}: ${r.topic}`,
          href: `/content/${r.id}`,
          className: r.published ? "border-tone-blue/40 bg-tone-blue/10" : APPROVAL_TONE[r.approvalStatus],
        }))}
      />
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-tone-amber/40 bg-tone-amber/20" /> Awaiting approval</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-tone-green/40 bg-tone-green/20" /> Approved</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-tone-red/40 bg-tone-red/20" /> Changes requested</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-tone-blue/40 bg-tone-blue/20" /> Published</span>
      </p>
    </div>
  );
}

function ListView({ sp, list, month, today, filtered }: { sp: SearchParams; list: Awaited<ReturnType<typeof getContentList>>; month: string; today: string; filtered: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{formatMonthKey(month)}</h2>
        <MonthLinks sp={sp} month={month} />
      </div>
      <ContentTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} today={today} filtered={filtered} />
    </div>
  );
}

function MonthLinks({ sp, month }: { sp: SearchParams; month: string }) {
  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" asChild><a href={withParams(sp, { month: shiftMonth(month, -1) })}>Previous</a></Button>
      <Button variant="outline" size="sm" asChild><a href={withParams(sp, { month: shiftMonth(month, 1) })}>Next</a></Button>
    </div>
  );
}
