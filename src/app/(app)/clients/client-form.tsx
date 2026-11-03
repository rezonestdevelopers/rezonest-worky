"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DuplicateDialog } from "@/components/shared/duplicate-dialog";
import { applyFieldErrors, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import type { ActionResult } from "@/lib/action-result";
import type { DuplicateMatch } from "@/lib/contact-match";
import { INDIA_STATES } from "@/lib/india-states";
import { clientCreateSchema, clientSchema, type ClientCreateInput } from "@/lib/validators/client";
import { createClientAction, updateClientAction } from "@/server/actions/clients";
import { convertLeadAction, linkLeadToClientAction } from "@/server/actions/leads";
import type { FormOptions } from "@/server/queries/options";

type Mode = { kind: "create" } | { kind: "edit"; clientId: string } | { kind: "convert"; leadId: string };

const STATE_OPTIONS = INDIA_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

export function ClientForm({ mode, defaults, options }: { mode: Mode; defaults: ClientCreateInput; options: FormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const editing = mode.kind === "edit";
  // On edit there's no first-contact section; contacts are managed on the client page.
  const form = useForm<ClientCreateInput, unknown, unknown & object>({
    resolver: zodResolver(editing ? clientSchema : clientCreateSchema) as never,
    defaultValues: defaults,
  });
  const india = (form.watch("country") ?? "").trim().toLowerCase() === "india";

  const finish = (res: ActionResult) => {
    if (res.ok) {
      toast.success(res.message ?? "Saved");
      setDuplicates(null);
      router.push(`/clients/${res.id}`);
    } else if (res.duplicates) {
      setDuplicates(res.duplicates);
    } else {
      toast.error(res.error);
      applyFieldErrors(form, res);
    }
  };

  const save = (confirmDuplicate: boolean) =>
    start(async () => {
      const values = form.getValues();
      if (mode.kind === "edit") finish(await updateClientAction(mode.clientId, values, confirmDuplicate));
      else if (mode.kind === "convert") finish(await convertLeadAction(mode.leadId, values, confirmDuplicate));
      else finish(await createClientAction(values, confirmDuplicate));
    });

  const cancelHref = mode.kind === "edit" ? `/clients/${mode.clientId}` : mode.kind === "convert" ? `/leads/${mode.leadId}` : "/clients";
  const submitLabel = mode.kind === "edit" ? "Save changes" : mode.kind === "convert" ? "Convert to client" : "Create client";

  return (
    <form onSubmit={form.handleSubmit(() => save(false), () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle>Company</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="companyName" label="Company name" required className="sm:col-span-2" autoFocus={mode.kind === "create"} />
          {!editing && <TextField form={form} name="contactName" label="Main contact person" required />}
          {!editing && <TextField form={form} name="contactDesignation" label="Designation" />}
          <TextField form={form} name="phone" label="Phone" inputMode="tel" />
          <TextField form={form} name="whatsapp" label="WhatsApp" inputMode="tel" />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="website" label="Website" placeholder="example.com" />
          <SelectField form={form} name="sectorId" label="Sector" options={options.sectors} noneLabel="Not set" />
          <SelectField form={form} name="leadSourceId" label="Lead source" options={options.sources} noneLabel="Not set" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Billing &amp; GST</CardTitle>
            <CardDescription>The state decides the tax on invoices: CGST + SGST for Maharashtra, IGST for other states.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="country" label="Country" required />
          {india ? (
            <SelectField form={form} name="stateCode" label="State" required options={STATE_OPTIONS} />
          ) : (
            <p className="self-end pb-2 text-xs text-muted-foreground">Clients outside India are billed as export of services, with no GST.</p>
          )}
          <TextField form={form} name="city" label="City" />
          <TextField form={form} name="pincode" label="PIN code" inputMode="numeric" />
          <TextAreaField form={form} name="billingAddress" label="Billing address" rows={2} className="sm:col-span-2" />
          <TextField form={form} name="gstin" label="GSTIN" placeholder="27ABCDE1234F1Z5" className="[&_input]:uppercase" />
          <TextField form={form} name="pan" label="PAN" placeholder="ABCDE1234F" className="[&_input]:uppercase" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Internal</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField form={form} name="accountManagerId" label="Account manager" options={options.users} noneLabel="Not assigned" />
          <SelectField form={form} name="status" label="Status" options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]} />
          <TextField form={form} name="tags" label="Tags" hint="Separate with commas, e.g. retainer, B2B" className="sm:col-span-2" />
          <TextAreaField form={form} name="notes" label="Notes" rows={3} className="sm:col-span-2" />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={cancelHref}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {submitLabel}
        </Button>
      </div>

      <DuplicateDialog
        matches={duplicates}
        onCancel={() => setDuplicates(null)}
        onConfirm={() => save(true)}
        confirmLabel={editing ? "Save anyway" : "Create new client anyway"}
        onLink={mode.kind === "convert" ? (clientId) => start(async () => finish(await linkLeadToClientAction(mode.leadId, clientId))) : undefined}
      />
    </form>
  );
}
