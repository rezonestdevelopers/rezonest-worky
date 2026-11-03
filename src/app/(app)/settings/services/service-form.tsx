"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, SelectField, TextField } from "@/components/shared/form-fields";
import { humanize } from "@/lib/status";
import { BILLING_TYPES, serviceSchema, type ServiceInput } from "@/lib/validators/catalogue";
import { saveServiceAction } from "@/server/actions/catalogue";

const BILLING_OPTIONS = BILLING_TYPES.map((b) => ({ value: b, label: humanize(b) }));

export function ServiceForm({ serviceId, defaults, departments }: { serviceId: string | null; defaults: ServiceInput; departments: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ServiceInput, unknown, z.output<typeof serviceSchema>>({ resolver: zodResolver(serviceSchema), defaultValues: defaults });
  const kpis = useFieldArray({ control: form.control, name: "defaultKpis" });
  const deliverables = useFieldArray({ control: form.control, name: "defaultDeliverables" });

  const save = () =>
    start(async () => {
      const res = await saveServiceAction(serviceId, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        if (serviceId) {
          form.reset(form.getValues());
          router.refresh();
        } else router.push(`/settings/services/${res.id}`);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle>Service details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField form={form} name="name" label="Service name" required className="sm:col-span-2" />
          <SelectField form={form} name="departmentId" label="Department" options={departments} noneLabel="Not set" />
          <SelectField form={form} name="billingType" label="Billing type" required options={BILLING_OPTIONS} />
          <TextField form={form} name="defaultPrice" label="Default price (₹)" required inputMode="decimal" />
          <TextField form={form} name="unit" label="Unit" required hint="month, post, project, year…" />
          <TextField form={form} name="gstRate" label="GST rate (%)" required inputMode="decimal" />
          <TextField form={form} name="sacCode" label="SAC code" inputMode="numeric" hint="Printed on invoices" />
          <TextField form={form} name="revisionsIncluded" label="Revisions per deliverable" type="number" min={0} />
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2 lg:col-span-3">
            <div>
              <Label htmlFor="isActive">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive services can&apos;t be added to new offers. Old records keep them.</p>
            </div>
            <Controller control={form.control} name="isActive" render={({ field }) => <Switch id="isActive" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Default KPIs</CardTitle>
              <CardDescription>Suggested targets when this service starts on a project.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => kpis.append({ metric: "", unit: "count" })}><Plus /> Add</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {kpis.fields.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            {kpis.fields.map((f, i) => (
              <div key={f.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input placeholder="e.g. Followers" aria-label="KPI name" aria-invalid={!!form.formState.errors.defaultKpis?.[i]?.metric} {...form.register(`defaultKpis.${i}.metric`)} />
                  {form.formState.errors.defaultKpis?.[i]?.metric && <p className="mt-1 text-xs text-tone-red">{form.formState.errors.defaultKpis[i]?.metric?.message}</p>}
                </div>
                <Input placeholder="Unit" aria-label="KPI unit" className="w-24" {...form.register(`defaultKpis.${i}.unit`)} />
                <Button type="button" variant="ghost" size="icon" onClick={() => kpis.remove(i)} aria-label="Remove KPI"><Trash2 /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Default deliverables</CardTitle>
              <CardDescription>What a typical month or job includes.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => deliverables.append({ name: "", qty: 1, unit: "" })}><Plus /> Add</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {deliverables.fields.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            {deliverables.fields.map((f, i) => (
              <div key={f.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input placeholder="e.g. Reel" aria-label="Deliverable name" aria-invalid={!!form.formState.errors.defaultDeliverables?.[i]?.name} {...form.register(`defaultDeliverables.${i}.name`)} />
                  {form.formState.errors.defaultDeliverables?.[i]?.name && <p className="mt-1 text-xs text-tone-red">{form.formState.errors.defaultDeliverables[i]?.name?.message}</p>}
                </div>
                <Input type="number" min={0} aria-label="Quantity" className="w-20" {...form.register(`defaultDeliverables.${i}.qty`)} />
                <Input placeholder="Unit" aria-label="Deliverable unit" className="w-24" {...form.register(`defaultDeliverables.${i}.unit`)} />
                <Button type="button" variant="ghost" size="icon" onClick={() => deliverables.remove(i)} aria-label="Remove deliverable"><Trash2 /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {serviceId ? "Save service" : "Create service"}
        </Button>
      </div>
    </form>
  );
}
