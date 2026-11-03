import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getTaskFormOptions } from "@/server/queries/tasks";
import { TaskForm } from "../task-form";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("work.manage");
  const sp = await searchParams;
  const options = await getTaskFormOptions();
  const projectId = idParam(sp, "project") ?? "";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="New task" back={{ href: projectId ? `/projects/${projectId}?tab=tasks` : "/tasks", label: projectId ? "Project" : "Tasks" }} />
      <TaskForm
        taskId={null}
        options={options}
        defaults={{ title: "", description: "", projectId, clientId: idParam(sp, "client") ?? "", serviceId: "", milestoneId: "", assigneeId: "", departmentId: "", priority: "MEDIUM", startDate: "", dueDate: "" }}
      />
    </div>
  );
}
