import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import { OnboardingCard } from "@/components/shared/onboarding-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDate, formatDateKey, formatMonthKey, shiftMonth, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { effectiveHealth } from "@/lib/health";
import { param, type SearchParams } from "@/lib/list-params";
import { formatINR } from "@/lib/money/format";
import { can } from "@/lib/permissions";
import { humanize } from "@/lib/status";
import { cn } from "@/lib/utils";
import { labelForFormat } from "@/lib/work-plan";
import { setProjectArchivedAction } from "@/server/actions/work";
import {
  currentMonth,
  getProjectChangeRequests,
  getProjectDeliverables,
  getProjectHeader,
  getProjectMilestones,
  getProjectOverview,
  getProjectTargets,
  getRetainerRuns,
} from "@/server/queries/projects";
import { getTaskList } from "@/server/queries/tasks";
import { refreshProject } from "@/server/services/projects";
import { loadViewer, type Viewer } from "@/server/services/tasks";
import { OpenDraftButton } from "@/app/(app)/invoices/open-draft-button";
import { ChangeRequestsPanel, MilestonesPanel, RetainerMonthButton, TargetsPanel } from "./project-panels";

export const metadata: Metadata = { title: "Project" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children || "—"}</dd>
  </div>
);

const Stat = ({ label, value, tone }: { label: string; value: number | string; tone?: string }) => (
  <Card className="gap-1 py-4">
    <CardContent className="px-4">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>{value}</div>
    </CardContent>
  </Card>
);

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("work.own");
  const { id } = await params;
  const viewer = await loadViewer(db, user);
  const canManage = can(user.role, "work.manage");
  const showMoney = can(user.role, "finance.manage");
  await refreshProject(db, id);
  const project = await getProjectHeader(id, viewer);
  if (!project) notFound();

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "tasks", label: "Tasks" },
    { key: "deliverables", label: "Deliverables" },
    { key: "milestones", label: "Milestones" },
    { key: "targets", label: "Targets" },
    ...(canManage ? [{ key: "changes", label: "Change requests" }, { key: "onboarding", label: "Onboarding" }] : []),
  ];
  const requested = param(await searchParams, "tab");
  const tab = TABS.find((t) => t.key === requested)?.key ?? "overview";
  const archived = !!project.archivedAt;
  const health = effectiveHealth(project.healthAuto, project.healthOverride);

  return (
    <div className="space-y-4">
      <PageHeader
        title={project.name}
        back={{ href: "/projects", label: "Projects" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="project" value={project.status} />
            <StatusBadge kind="health" value={health} />
            <span>{project.code}</span>
            <span>{project.client.companyName}</span>
          </span>
        }
        actions={
          canManage &&
          (archived ? (
            <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this project?" description="It comes back to your lists." confirmLabel="Restore" action={setProjectArchivedAction.bind(null, id, false)} />
          ) : (
            <>
              <Button size="sm" asChild><Link href={`/tasks/new?project=${id}`}><Plus /> New task</Link></Button>
              <Button variant="outline" size="sm" asChild><Link href={`/projects/${id}/edit`}><Pencil /> Edit</Link></Button>
              <ConfirmButton label="Archive" icon={<Archive />} title="Archive this project?" description="Only completed or cancelled projects can be archived. Nothing is deleted." confirmLabel="Archive" action={setProjectArchivedAction.bind(null, id, true)} />
            </>
          ))
        }
      />
      {project.healthOverride && (
        <div role="status" className="rounded-lg border border-tone-amber/30 bg-tone-amber/10 px-3 py-2 text-sm">
          Health set by hand: {project.healthOverrideNote}. Worked out automatically it would be {humanize(project.healthAuto)}.
        </div>
      )}
      <nav aria-label="Project sections" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/projects/${id}?tab=${t.key}`}
            scroll={false}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", t.key === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Suspense key={tab} fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
        {tab === "overview" && <Overview project={project} viewer={viewer} showMoney={showMoney} canManage={canManage} />}
        {tab === "tasks" && <TasksTab projectId={id} viewer={viewer} />}
        {tab === "deliverables" && <DeliverablesTab showMoney={showMoney} project={project} canManage={canManage} />}
        {tab === "milestones" && <MilestonesTab projectId={id} canManage={canManage} showMoney={showMoney} />}
        {tab === "targets" && <TargetsTab projectId={id} canManage={canManage} />}
        {tab === "changes" && canManage && <ChangesTab showMoney={showMoney} projectId={id} />}
        {tab === "onboarding" && canManage && <OnboardingTab project={project} />}
      </Suspense>
    </div>
  );
}

type Header = NonNullable<Awaited<ReturnType<typeof getProjectHeader>>>;

async function Overview({ project, viewer, showMoney, canManage }: { project: Header; viewer: Viewer; showMoney: boolean; canManage: boolean }) {
  const o = await getProjectOverview(project.id, viewer);
  const items = project.onboarding?.items ?? [];
  const onboardingDone = items.filter((i) => i.isDone).length;
  return (
    <div className="space-y-4">
      {showMoney && project.services.some((s) => s.billingType !== "MONTHLY_RETAINER") && (
        <div className="flex justify-end"><OpenDraftButton kind="project" id={project.id} label="Invoice one-time work" /></div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Progress" value={`${project.progressPercent}%`} />
        <Stat label="Open tasks" value={o.open} />
        <Stat label="Overdue" value={o.overdue} tone={o.overdue ? "text-tone-red" : undefined} />
        <Stat label="Due in 7 days" value={o.week} />
        {canManage && <Stat label="Onboarding" value={items.length ? `${Math.round((onboardingDone / items.length) * 100)}%` : "—"} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Client">{canManage ? <Link href={`/clients/${project.client.id}`} className="underline">{project.client.companyName}</Link> : project.client.companyName}</Row>
              {canManage && <Row label="Offer">{project.offer && <Link href={`/offers/${project.offer.id}`} className="underline">{project.offer.number}</Link>}</Row>}
              <Row label="Manager">{project.manager?.name}</Row>
              <Row label="Started">{formatDateKey(project.startDate)}</Row>
              <Row label="Deadline">{project.deadline ? formatDateKey(project.deadline) : null}</Row>
              {project.isRetainer && <Row label="Retainer ends">{project.retainerEnd ? `${formatDateKey(project.retainerEnd)}${project.autoRenew ? " (auto-renews)" : ""}` : null}</Row>}
            </dl>
            {project.notes && <p className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground">{project.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Services</CardTitle></CardHeader>
          <CardContent>
            {project.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">No services.</p>
            ) : (
              <ul className="divide-y">
                {project.services.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{s.service.name}</div>
                      {s.description && s.description !== s.service.name && <div className="truncate text-xs text-muted-foreground">{s.description}</div>}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {humanize(s.billingType)}
                      {showMoney && <div className="font-medium text-foreground tabular-nums">{formatINR(s.billingType === "MONTHLY_RETAINER" ? s.monthlyValue : s.rate, { decimals: false })}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function TasksTab({ projectId, viewer }: { projectId: string; viewer: Viewer }) {
  const list = await getTaskList({ project: projectId, open: "1", size: "50" }, viewer);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open tasks<span className="ml-2 font-normal text-muted-foreground tabular-nums">{list.total}</span></CardTitle>
        <Button variant="outline" size="sm" asChild><Link href={`/tasks?project=${projectId}&show=all`}>All tasks and views</Link></Button>
      </CardHeader>
      <CardContent>
        {list.rows.length === 0 ? (
          <EmptyState title="No open tasks" />
        ) : (
          <ul className="divide-y">
            {list.rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.title}</Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge kind="task" value={t.status} />
                  <span className="tabular-nums">{formatDateKey(t.dueDate)}</span>
                  <span>{t.assignee ?? t.department ?? "Unassigned"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function DeliverablesTab({ project, canManage, showMoney }: { project: Header; canManage: boolean; showMoney: boolean }) {
  const [{ rows, months }, runs] = await Promise.all([getProjectDeliverables(project.id), project.isRetainer ? getRetainerRuns(project.id) : []]);
  const thisMonth = currentMonth();
  const nextMonth = shiftMonth(thisMonth, 1);
  const hasRun = (m: string) => runs.some((r) => r.month === m);
  const inPeriod = (m: string) => !project.retainerEnd || `${m}-01` <= dateOnlyKey(project.retainerEnd);
  return (
    <div className="space-y-4">
      {showMoney && project.isRetainer && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">Each month&apos;s invoice is drafted automatically on day {project.retainerTaskDay}, for you to review. It&apos;s never sent by itself.</p>
            <OpenDraftButton kind="retainer" id={project.id} month={thisMonth} label={`Invoice ${formatMonthKey(thisMonth)}`} />
          </CardContent>
        </Card>
      )}
      {canManage && project.isRetainer && project.status === "ACTIVE" && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">Each month&apos;s deliverables and tasks are created automatically on day {project.retainerTaskDay}. You can create them early here. A month is never created twice.</p>
            <div className="flex flex-wrap gap-2">
              {!hasRun(thisMonth) && <RetainerMonthButton projectId={project.id} month={thisMonth} label={`Create ${formatMonthKey(thisMonth)}`} />}
              {!hasRun(nextMonth) && inPeriod(nextMonth) && <RetainerMonthButton projectId={project.id} month={nextMonth} label={`Create ${formatMonthKey(nextMonth)} early`} />}
            </div>
          </CardContent>
        </Card>
      )}
      {months.length === 0 ? (
        <Card><CardContent><EmptyState title="No deliverables yet" hint={project.isRetainer ? "They come from the monthly package on the offer." : "This project has no counted deliverables."} /></CardContent></Card>
      ) : (
        months.map((m) => {
          const pct = m.committed ? Math.round((m.delivered / m.committed) * 100) : 0;
          return (
            <Card key={m.month}>
              <CardHeader>
                <div>
                  <CardTitle>{m.month === "One-off" ? m.month : formatMonthKey(m.month)}</CardTitle>
                </div>
                <span className="text-sm font-semibold tabular-nums" data-testid="deliverable-count">{m.delivered}/{m.committed} delivered</span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.month} delivered`}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--chart-3)" }} />
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {Array.from(m.byFormat.entries()).map(([f, c]) => (
                    <span key={f} className="rounded-full border bg-card-solid px-2.5 py-1 tabular-nums">{f === "OTHER" ? "Other" : `${labelForFormat(f)}s`} {c.delivered}/{c.committed}</span>
                  ))}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">See each deliverable</summary>
                  <ul className="mt-2 divide-y text-sm">
                    {rows.filter((d) => (d.month ?? "One-off") === m.month).map((d) => (
                      <li key={d.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className={cn("min-w-0", d.deliveredAt && "text-muted-foreground")}>{d.title}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {d.deliveredAt ? `Delivered ${formatDate(d.deliveredAt)}` : `Due ${formatDateKey(d.dueDate)}`} · revisions {d.revisionsUsed}/{d.revisionsIncluded}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

async function MilestonesTab({ projectId, canManage, showMoney }: { projectId: string; canManage: boolean; showMoney: boolean }) {
  const rows = await getProjectMilestones(projectId);
  return (
    <MilestonesPanel
      projectId={projectId}
      today={todayKey()}
      canManage={canManage}
      rows={rows.map((m) => ({
        id: m.id,
        name: m.name,
        dueDate: m.dueDate ? dateOnlyKey(m.dueDate) : null,
        // Managers need the percentage too: saving a milestone sends it back unchanged.
        paymentPercent: canManage ? (m.paymentPercent?.toString() ?? null) : null,
        amount: showMoney && m.amount ? formatINR(m.amount) : null,
        status: m.status,
        openTasks: m._count.tasks,
        invoice: showMoney && m.invoices[0] ? { id: m.invoices[0].id, label: m.invoices[0].number ?? "Draft invoice" } : null,
        canInvoice: showMoney && !!m.paymentPercent && !m.invoices.length,
      }))}
    />
  );
}

async function TargetsTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const rows = await getProjectTargets(projectId);
  return (
    <TargetsPanel
      projectId={projectId}
      currentMonth={currentMonth()}
      canManage={canManage}
      rows={rows.map((t) => ({
        id: t.id,
        metric: t.metric,
        unit: t.unit,
        target: t.targetValue.toString(),
        higherIsBetter: t.higherIsBetter,
        serviceName: null,
        progress: t.progress.map((p) => ({ month: p.month, actual: p.actualValue.toString() })),
      }))}
    />
  );
}

async function ChangesTab({ projectId, showMoney }: { projectId: string; showMoney: boolean }) {
  const [rows, { rows: deliverables }] = await Promise.all([getProjectChangeRequests(projectId), getProjectDeliverables(projectId)]);
  return (
    <ChangeRequestsPanel
      projectId={projectId}
      showMoney={showMoney}
      deliverables={deliverables.slice(0, 100).map((d) => ({ value: d.id, label: d.title }))}
      rows={rows.map((c) => ({
        id: c.id, description: c.description, estimate: formatINR(c.estimate), isBillable: c.isBillable, status: c.status, deliverable: c.deliverable?.title ?? null, created: formatDate(c.createdAt),
        canInvoice: showMoney && c.status === "APPROVED" && c.isBillable && !c.invoiceItemId,
      }))}
    />
  );
}

function OnboardingTab({ project }: { project: Header }) {
  if (!project.onboarding) return <Card><CardContent><EmptyState title="No onboarding checklist" hint="This project started without one." /></CardContent></Card>;
  return (
    <div className="max-w-2xl">
      <OnboardingCard
        checklistId={project.onboarding.id}
        items={project.onboarding.items.map((i) => ({ id: i.id, title: i.title, isDone: i.isDone, doneAt: i.doneAt ? formatDate(i.doneAt) : null }))}
      />
    </div>
  );
}
