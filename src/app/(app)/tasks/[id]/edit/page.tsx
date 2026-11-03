import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getTaskFormOptions } from "@/server/queries/tasks";
import { TaskForm } from "../../task-form";

export const metadata: Metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work.manage");
  const { id } = await params;
  const t = await db.task.findUnique({ where: { id } });
  if (!t) notFound();
  if (t.archivedAt) redirect(`/tasks/${id}`);
  const options = await getTaskFormOptions({ assigneeId: t.assigneeId });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Edit task" back={{ href: `/tasks/${id}`, label: "Back to task" }} />
      <TaskForm
        taskId={id}
        options={options}
        defaults={{
          title: t.title, description: t.description ?? "", projectId: t.projectId ?? "", clientId: t.clientId ?? "", serviceId: t.serviceId ?? "", milestoneId: t.milestoneId ?? "",
          assigneeId: t.assigneeId ?? "", departmentId: t.departmentId ?? "", priority: t.priority,
          startDate: t.startDate ? dateOnlyKey(t.startDate) : "", dueDate: t.dueDate ? dateOnlyKey(t.dueDate) : "",
        }}
      />
    </div>
  );
}
