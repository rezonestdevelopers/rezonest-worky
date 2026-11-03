import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey, formatDateTime, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/work-plan";
import { setTaskArchivedAction } from "@/server/actions/work";
import { getTaskDetail } from "@/server/queries/tasks";
import { loadViewer } from "@/server/services/tasks";
import { TaskStatusSelect } from "../task-status";
import { AttachmentsPanel, ChecklistPanel, CommentsPanel, RevisionsPanel, TimePanel } from "./task-panels";

export const metadata: Metadata = { title: "Task" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || "—"}</dd>
    </div>
  );
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("work.own");
  const { id } = await params;
  const canManage = can(user.role, "work.manage");
  const task = await getTaskDetail(id, await loadViewer(db, user));
  // The same "not found" whether it doesn't exist or isn't theirs.
  if (!task) notFound();

  const today = todayKey();
  const due = task.dueDate ? dateOnlyKey(task.dueDate) : null;
  const late = due && due < today && task.status !== "DONE" && task.status !== "WAITING_CLIENT_APPROVAL";
  const total = task.timeLogs.reduce((n, l) => n + l.minutes, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={task.title}
        back={{ href: "/tasks", label: "Tasks" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="task" value={task.status} />
            <StatusBadge kind="priority" value={task.priority} />
          </span>
        }
        actions={
          canManage &&
          (task.archivedAt ? (
            <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this task?" description="It comes back to your task lists." confirmLabel="Restore" action={setTaskArchivedAction.bind(null, id, false)} />
          ) : (
            <>
              <Button variant="outline" size="sm" asChild><Link href={`/tasks/${id}/edit`}><Pencil /> Edit</Link></Button>
              <ConfirmButton label="Archive" icon={<Archive />} title="Archive this task?" description="It disappears from lists and no longer counts towards progress. Nothing is deleted." confirmLabel="Archive" action={setTaskArchivedAction.bind(null, id, true)} />
            </>
          ))
        }
      />
      {task.archivedAt && <div role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">Archived on {formatDateTime(task.archivedAt)}.</div>}
      {task.status === "BLOCKED" && task.blockedReason && <div role="status" className="rounded-lg border border-tone-red/30 bg-tone-red/10 px-3 py-2 text-sm">Blocked: {task.blockedReason}</div>}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-4">
          {task.description && (
            <Card>
              <CardHeader><CardTitle>Description</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-wrap">{task.description}</p></CardContent>
            </Card>
          )}
          <ChecklistPanel taskId={id} items={task.checklist.map((i) => ({ id: i.id, title: i.title, isDone: i.isDone }))} />
          <CommentsPanel taskId={id} comments={task.comments.map((c) => ({ id: c.id, author: c.author.name, when: formatDateTime(c.createdAt), body: c.body }))} />
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-3">
              {!task.archivedAt && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <TaskStatusSelect taskId={id} status={task.status as TaskStatus} />
                </div>
              )}
              <dl className="divide-y">
                <Row label="Due"><span className={cn(late && "font-medium text-tone-red")}>{formatDateKey(due)}</span></Row>
                <Row label="Starts">{task.startDate ? formatDateKey(task.startDate) : null}</Row>
                <Row label="Assigned to">{task.assignee?.name}</Row>
                <Row label="Department">{task.department?.name}</Row>
                <Row label="Client">{task.client && (canManage ? <Link href={`/clients/${task.client.id}`} className="underline">{task.client.companyName}</Link> : task.client.companyName)}</Row>
                <Row label="Project">{task.project && <Link href={`/projects/${task.project.id}`} className="underline">{task.project.name}</Link>}</Row>
                <Row label="Milestone">{task.milestone?.name}</Row>
                <Row label="Service">{task.service?.name}</Row>
                {task.completedAt && <Row label="Completed">{formatDateTime(task.completedAt)}</Row>}
              </dl>
            </CardContent>
          </Card>
          <RevisionsPanel
            taskId={id}
            revisions={task.revisionCount}
            deliverable={task.deliverable ? { used: task.deliverable.revisionsUsed, included: task.deliverable.revisionsIncluded } : null}
            changeRequestHref={canManage && task.projectId ? `/projects/${task.projectId}?tab=changes` : null}
          />
          <TimePanel
            taskId={id}
            today={today}
            totalMinutes={total}
            logs={task.timeLogs.map((l) => ({ id: l.id, who: l.user.name, date: formatDateKey(l.date), minutes: l.minutes, note: l.note }))}
          />
          <AttachmentsPanel taskId={id} files={task.attachments.map((f) => ({ id: f.id, name: f.name, size: `${Math.ceil(f.sizeBytes / 1024)} KB` }))} />
        </div>
      </div>
    </div>
  );
}
