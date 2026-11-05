"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, Loader2, Save, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { applyFieldErrors, FieldNote, SelectField, TextField } from "@/components/shared/form-fields";
import { canPreview, formatFileSize } from "@/lib/file-types";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/profit";
import { expenseSchema, type ExpenseInput } from "@/lib/validators/expense";
import { saveExpenseAction, uploadBillAction } from "@/server/actions/expenses";

type Options = { clients: { value: string; label: string }[]; projects: { value: string; label: string; clientId: string }[] };

export function ExpenseForm({ id, defaults, options, today }: { id: string | null; defaults: ExpenseInput; options: Options; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ExpenseInput>({ resolver: zodResolver(expenseSchema) as never, defaultValues: defaults });
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const projects = clientId ? options.projects.filter((p) => p.clientId === clientId) : options.projects;

  useEffect(() => {
    const current = form.getValues("projectId");
    if (current && clientId && !options.projects.some((p) => p.value === current && p.clientId === clientId)) form.setValue("projectId", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the client changes
  }, [clientId]);

  const save = () =>
    start(async () => {
      const res = await saveExpenseAction(id, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        if (id) router.refresh();
        else router.push(`/expenses/${res.id}`);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="date" label="Date" type="date" required max={today} />
          <SelectField form={form} name="category" label="Category" required options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: expenseCategoryLabel(c) }))} />
          <TextField form={form} name="description" label="Description" required className="sm:col-span-2" />
          <TextField form={form} name="vendor" label="Paid to" placeholder="Vendor or freelancer" className="sm:col-span-2" />
          <TextField form={form} name="amount" label="Amount before GST (₹)" required inputMode="decimal" />
          <TextField form={form} name="gstPaid" label="GST paid (₹)" inputMode="decimal" hint="Kept separately. It isn't counted in profit." />
          <SelectField form={form} name="clientId" label="Client" noneLabel="No client (agency overhead)" options={options.clients} />
          <SelectField form={form} name="projectId" label="Project" noneLabel="No project" options={projects} hint="Linking a project counts this against its profit." />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href="/expenses">Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save expense</Button>
      </div>
    </form>
  );
}

export function BillCard({ expenseId, bill }: { expenseId: string; bill: { id: string; name: string; mimeType: string; sizeBytes: number } | null }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const upload = () =>
    start(async () => {
      setError(undefined);
      const chosen = file.current?.files?.[0];
      if (!chosen) {
        setError("Please choose a file.");
        return;
      }
      const data = new FormData();
      data.set("expenseId", expenseId);
      data.set("file", chosen);
      const res = await uploadBillAction(data);
      if (res.ok) {
        toast.success(res.message ?? "Attached");
        if (file.current) file.current.value = "";
        router.refresh();
      } else setError(res.error);
    });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Bill</CardTitle>
          <CardDescription>A photo or PDF of the bill, up to 20 MB.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {bill ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="bill">
            <span className="min-w-0 truncate font-medium" title={bill.name}>{bill.name} <span className="font-normal text-muted-foreground">· {formatFileSize(bill.sizeBytes)}</span></span>
            <div className="flex gap-1">
              {canPreview(bill.mimeType) && <Button variant="ghost" size="sm" asChild><a href={`/api/documents/${bill.id}?view=1`} target="_blank" rel="noopener noreferrer"><Eye /> Preview</a></Button>}
              <Button variant="ghost" size="sm" asChild><a href={`/api/documents/${bill.id}`}>Download</a></Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No bill attached.</p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-56 space-y-1.5">
            <Label htmlFor="billFile">{bill ? "Replace the bill" : "Attach the bill"}</Label>
            <input id="billFile" ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm" />
          </div>
          <Button variant="outline" disabled={pending} onClick={upload}>{pending ? <Loader2 className="animate-spin" /> : <Upload />} Upload</Button>
        </div>
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}
