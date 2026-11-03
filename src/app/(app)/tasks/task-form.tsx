"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { applyFieldErrors, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { statusDef } from "@/lib/status";
import { PRIORITIES } from "@/lib/validators/catalogue";
import { taskSchema, type TaskData, type TaskInput } from "@/lib/validators/work";
import { saveTaskAction } from "@/server/actions/work";
import type { TaskFormOptions } from "@/server/queries/tasks";

export function TaskForm({ taskId, defaults, options }: { taskId: string | null; defaults: TaskInput; options: TaskFormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<TaskInput, unknown, TaskData>({ resolver: zodResolver(taskSchema), defaultValues: defaults });
  const projectId = useWatch({ control: form.control, name: "projectId" });
  const milestones = options.milestones.filter((m) => m.projectId === projectId);

  const save = () =>
    start(async () => {
      const res = await saveTaskAction(taskId, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/tasks/${res.id}`);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="title" label="Task" required className="sm:col-span-2" autoFocus={!taskId} />
          <TextAreaField form={form} name="description" label="Description" rows={3} className="sm:col-span-2" />
          <SelectField form={form} name="projectId" label="Project" options={options.projects} noneLabel="No project" />
          {projectId ? (
            <SelectField form={form} name="milestoneId" label="Milestone" options={milestones} noneLabel="No milestone" />
          ) : (
            <SelectField form={form} name="clientId" label="Client" options={options.clients} noneLabel="No client" />
          )}
          <SelectField form={form} name="assigneeId" label="Assigned to" options={options.users} noneLabel="Nobody yet" hint="Choose a person, a department, or both" />
          <SelectField form={form} name="departmentId" label="Department" options={options.departments} noneLabel="None" />
          <SelectField form={form} name="serviceId" label="Service" options={options.services} noneLabel="None" />
          <SelectField form={form} name="priority" label="Priority" required options={PRIORITIES.map((p) => ({ value: p, label: statusDef("priority", p).label }))} />
          <TextField form={form} name="startDate" label="Start date" type="date" />
          <TextField form={form} name="dueDate" label="Due date" type="date" />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={taskId ? `/tasks/${taskId}` : "/tasks"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {taskId ? "Save task" : "Create task"}</Button>
      </div>
    </form>
  );
}
