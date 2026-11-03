"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { statusDef } from "@/lib/status";
import { PROJECT_STATUSES, projectSchema, type ProjectInput } from "@/lib/validators/work";
import { updateProjectAction } from "@/server/actions/work";

export function ProjectForm({ id, isRetainer, autoHealth, people, defaults }: { id: string; isRetainer: boolean; autoHealth: string; people: { value: string; label: string }[]; defaults: ProjectInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ProjectInput, unknown, z.output<typeof projectSchema>>({ resolver: zodResolver(projectSchema), defaultValues: defaults });
  const override = useWatch({ control: form.control, name: "healthOverride" });

  const save = () =>
    start(async () => {
      const res = await updateProjectAction(id, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/projects/${id}`);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="name" label="Project name" required className="sm:col-span-2" />
          <SelectField form={form} name="managerId" label="Project manager" options={people} noneLabel="Not assigned" />
          <SelectField form={form} name="status" label="Status" required options={PROJECT_STATUSES.map((s) => ({ value: s, label: statusDef("project", s).label }))} />
          <TextField form={form} name="startDate" label="Start date" type="date" required />
          <TextField form={form} name="deadline" label="Deadline" type="date" />
          {isRetainer && <TextField form={form} name="retainerEnd" label="Retainer ends" type="date" />}
          {isRetainer && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="autoRenew">Auto-renew</Label>
              <Controller control={form.control} name="autoRenew" render={({ field }) => <Switch id="autoRenew" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          )}
          <TextAreaField form={form} name="notes" label="Notes" rows={3} className="sm:col-span-2" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Health</CardTitle>
            <CardDescription>Worked out automatically as {statusDef("health", autoHealth).label}, from overdue tasks and missed milestones. Only override it if you know something the numbers don&apos;t.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField form={form} name="healthOverride" label="Override" noneLabel="Automatic" options={["ON_TRACK", "AT_RISK", "DELAYED"].map((h) => ({ value: h, label: statusDef("health", h).label }))} />
          {override && <TextField form={form} name="healthOverrideNote" label="Why?" required />}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={`/projects/${id}`}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save project</Button>
      </div>
    </form>
  );
}
