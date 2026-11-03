"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NONE } from "@/components/shared/form-fields";
import { statusDef } from "@/lib/status";
import { PRIORITIES, type TaskTemplateInput } from "@/lib/validators/catalogue";
import { saveTaskTemplateAction } from "@/server/actions/catalogue";

type Option = { value: string; label: string };

/** Steps that make up the tasks of a service. Tasks get created from these starting in Phase 4. */
export function TemplatesEditor({
  serviceId, templates, departments, subServices,
}: {
  serviceId: string;
  templates: TaskTemplateInput[];
  departments: Option[];
  subServices: Option[];
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Task templates</CardTitle>
          <CardDescription>The steps used to create tasks when this work starts. The number beside each step is how many days it takes. Changes only affect tasks created later.</CardDescription>
        </div>
        {!adding && <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> New template</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        {templates.length === 0 && !adding && <p className="text-sm text-muted-foreground">None yet.</p>}
        {templates.map((t) => <TemplateForm key={t.id} template={t} departments={departments} subServices={subServices} />)}
        {adding && (
          <TemplateForm
            template={{
              serviceId, name: "", subServiceId: "", isActive: true,
              steps: [{ title: "", departmentId: "", durationDays: 1, priority: "MEDIUM", isClientApproval: false }],
            }}
            departments={departments}
            subServices={subServices}
            onSaved={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function TemplateForm({
  template, departments, subServices, onSaved, onCancel,
}: {
  template: TaskTemplateInput;
  departments: Option[];
  subServices: Option[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<TaskTemplateInput>({ defaultValues: template });
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "steps" });
  const name = form.watch("name");

  const save = () =>
    start(async () => {
      const res = await saveTaskTemplateAction(form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        onSaved?.();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <section aria-label={name || "New template"} className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>Template name</Label>
          <Input aria-label="Template name" {...form.register("name")} />
        </div>
        <div className="space-y-1.5">
          <Label>For sub-service</Label>
          <Controller
            control={form.control}
            name="subServiceId"
            render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                <SelectTrigger className="w-full" aria-label="For sub-service"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Whole service</SelectItem>
                  {subServices.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex h-9 items-center gap-2">
          <Label>Active</Label>
          <Controller control={form.control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Template is active" />} />
        </div>
      </div>

      <ol className="space-y-2">
        {fields.map((f, i) => (
          <li key={f.id} className="grid grid-cols-2 items-center gap-2 rounded-md bg-muted/40 p-2 lg:grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,1.5fr)_5rem_6.5rem_auto_auto]">
            <span className="hidden text-center text-xs text-muted-foreground tabular-nums lg:block">{i + 1}</span>
            <Input className="col-span-2 lg:col-span-1" placeholder="Step name" aria-label={`Step ${i + 1} name`} {...form.register(`steps.${i}.title`)} />
            <Controller
              control={form.control}
              name={`steps.${i}.departmentId`}
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger className="w-full" aria-label={`Step ${i + 1} department`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No department</SelectItem>
                    {departments.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <Input type="number" min={1} title="Days" aria-label={`Step ${i + 1} days`} {...form.register(`steps.${i}.durationDays`)} />
            <Controller
              control={form.control}
              name={`steps.${i}.priority`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full" aria-label={`Step ${i + 1} priority`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{statusDef("priority", p).label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <Controller control={form.control} name={`steps.${i}.isClientApproval`} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`Step ${i + 1} needs client approval`} />} />
              Client approval
            </label>
            <div className="flex justify-end gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move step ${i + 1} up`}><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === fields.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move step ${i + 1} down`}><ArrowDown /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={fields.length === 1} onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}><Trash2 /></Button>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ title: "", departmentId: "", durationDays: 1, priority: "MEDIUM", isClientApproval: false })}
        >
          <Plus /> Add step
        </Button>
        <div className="flex gap-2">
          {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save template
          </Button>
        </div>
      </div>
    </section>
  );
}
