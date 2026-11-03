"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, FieldNote, SelectField, TextField } from "@/components/shared/form-fields";
import { convertOfferSchema, type ConvertOfferData, type ConvertOfferInput } from "@/lib/validators/work";
import { convertOfferAction } from "@/server/actions/work";

export type ConvertTargetRow = { serviceId: string; serviceName: string; metric: string; unit: string; targetValue: string; higherIsBetter: boolean };
type Defaults = Omit<ConvertOfferInput, "targets"> & { targets: ConvertTargetRow[] };

export function ConvertForm({
  isRetainer, people, skipped, defaults, offerId,
}: {
  offerId: string;
  isRetainer: boolean;
  people: { value: string; label: string }[];
  skipped: string[];
  defaults: Defaults;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ConvertOfferInput, unknown, ConvertOfferData>({ resolver: zodResolver(convertOfferSchema), defaultValues: defaults });
  const milestones = useFieldArray({ control: form.control, name: "milestones" });
  const errors = form.formState.errors as Record<string, { message?: string; root?: { message?: string } } | undefined>;

  const save = () =>
    start(async () => {
      const res = await convertOfferAction(form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Project created");
        router.push(`/projects/${res.id}`);
      } else {
        toast.error(res.fieldErrors?.milestones ?? res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      {skipped.length > 0 && (
        <div role="status" className="rounded-lg border border-tone-amber/30 bg-tone-amber/10 px-3 py-2 text-sm">
          These custom items aren&apos;t linked to a service, so they won&apos;t get project services or tasks: {skipped.join("; ")}. You can add tasks for them by hand.
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>Project</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="name" label="Project name" required className="sm:col-span-2" />
          <SelectField form={form} name="managerId" label="Project manager" options={people} noneLabel="Not assigned" />
          <TextField form={form} name="startDate" label="Start date" type="date" required />
          <TextField form={form} name="deadline" label="Deadline" type="date" hint={isRetainer ? "Optional for retainers" : "When this should be finished"} />
          {isRetainer && <TextField form={form} name="retainerEnd" label="Retainer ends" type="date" required hint="Worked out from the offer's duration" />}
          {isRetainer && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="autoRenew">Auto-renew</Label>
                <p className="text-xs text-muted-foreground">When the period ends it continues for the same length.</p>
              </div>
              <Controller control={form.control} name="autoRenew" render={({ field }) => <Switch id="autoRenew" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="createTasks">Create tasks now</Label>
              <p className="text-xs text-muted-foreground">From each service&apos;s task template{isRetainer ? ", including this month's deliverables" : ""}.</p>
            </div>
            <Controller control={form.control} name="createTasks" render={({ field }) => <Switch id="createTasks" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Milestones</CardTitle>
            <CardDescription>Optional. Payment percentages come from the offer.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => milestones.append({ name: "", dueDate: "", paymentPercent: "" })}><Plus /> Add</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <FieldNote error={errors.milestones?.message ?? errors.milestones?.root?.message} />
          {milestones.fields.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {milestones.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_5rem_auto]">
              <Input placeholder="Milestone" aria-label={`Milestone ${i + 1} name`} {...form.register(`milestones.${i}.name`)} />
              <Button type="button" variant="ghost" size="icon" className="sm:order-last" onClick={() => milestones.remove(i)} aria-label={`Remove milestone ${i + 1}`}><Trash2 /></Button>
              <Input type="date" aria-label={`Milestone ${i + 1} due date`} {...form.register(`milestones.${i}.dueDate`)} />
              <Input placeholder="%" inputMode="decimal" aria-label={`Milestone ${i + 1} payment percent`} {...form.register(`milestones.${i}.paymentPercent`)} />
            </div>
          ))}
        </CardContent>
      </Card>

      {defaults.targets.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Targets</CardTitle>
              <CardDescription>What you&apos;ve promised for each service. Leave a value blank to skip that target.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {defaults.targets.map((t, i) => (
              <div key={`${t.serviceId}-${t.metric}`} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{t.metric}{t.unit && t.unit !== "count" ? ` (${t.unit})` : ""}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.serviceName}</div>
                </div>
                <Input inputMode="decimal" aria-label={`${t.metric} target`} {...form.register(`targets.${i}.targetValue`)} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={`/offers/${offerId}`}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Briefcase />} Create project</Button>
      </div>
    </form>
  );
}
