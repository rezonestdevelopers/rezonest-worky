"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, SelectField, TextField } from "@/components/shared/form-fields";
import { employeeSchema, type EmployeeInput } from "@/lib/validators/work";
import { createEmployeeAction, updateEmployeeAction } from "@/server/actions/work";

const ROLE_OPTIONS = [
  { value: "EMPLOYEE", label: "Employee: own and department tasks only" },
  { value: "MANAGER", label: "Manager: sales and all work, no invoices or profit" },
  { value: "ADMIN", label: "Admin: everything" },
];

export function EmployeeForm({ id, defaults, departments }: { id: string | null; defaults: EmployeeInput; departments: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<EmployeeInput, unknown, z.output<typeof employeeSchema>>({ resolver: zodResolver(employeeSchema), defaultValues: defaults });

  const save = () =>
    start(async () => {
      const res = id ? await updateEmployeeAction(id, form.getValues()) : await createEmployeeAction(form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/team/${res.id}`);
        router.refresh();
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="name" label="Name" required />
          <TextField form={form} name="email" label="Email" type="email" required hint="They sign in with this" />
          <TextField form={form} name="phone" label="Phone" inputMode="tel" />
          <SelectField form={form} name="departmentId" label="Department" options={departments} noneLabel="None" />
          <TextField form={form} name="designation" label="Designation" />
          <TextField form={form} name="joiningDate" label="Joining date" type="date" />
          <SelectField form={form} name="role" label="Access" required options={ROLE_OPTIONS} className="sm:col-span-2" />
          <TextField form={form} name="hourlyCost" label="Hourly cost (₹)" inputMode="decimal" hint="For profit figures. Only admins see this." />
          <div className="flex items-center justify-between gap-3 self-start rounded-lg border p-3">
            <div>
              <Label htmlFor="dailyDigest">Daily task email</Label>
              <p className="text-xs text-muted-foreground">Their tasks due and overdue, each morning.</p>
            </div>
            <Controller control={form.control} name="dailyDigest" render={({ field }) => <Switch id="dailyDigest" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          <div className="flex items-center justify-between gap-3 self-start rounded-lg border p-3">
            <div>
              <Label htmlFor="emailOnTask">Email when assigned or mentioned</Label>
              <p className="text-xs text-muted-foreground">They always get it in the app too.</p>
            </div>
            <Controller control={form.control} name="emailOnTask" render={({ field }) => <Switch id="emailOnTask" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={id ? `/team/${id}` : "/team"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save" : "Add person"}</Button>
      </div>
    </form>
  );
}
