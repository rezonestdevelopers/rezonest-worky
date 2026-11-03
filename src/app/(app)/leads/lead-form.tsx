"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DuplicateDialog } from "@/components/shared/duplicate-dialog";
import { applyFieldErrors, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import type { DuplicateMatch } from "@/lib/contact-match";
import { cn } from "@/lib/utils";
import { leadSchema, type LeadData, type LeadInput } from "@/lib/validators/lead";
import { saveLeadAction } from "@/server/actions/leads";
import type { FormOptions } from "@/server/queries/options";

export function LeadForm({ leadId, defaults, options }: { leadId: string | null; defaults: LeadInput; options: FormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const form = useForm<LeadInput, unknown, LeadData>({ resolver: zodResolver(leadSchema), defaultValues: defaults });

  const save = (confirmDuplicate: boolean) =>
    start(async () => {
      const res = await saveLeadAction(leadId, form.getValues(), confirmDuplicate);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        setDuplicates(null);
        router.push(`/leads/${res.id}`);
      } else if (res.duplicates) {
        setDuplicates(res.duplicates);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(() => save(false), () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="contactName" label="Contact person" required autoFocus={!leadId} />
          <TextField form={form} name="companyName" label="Company" />
          <TextField form={form} name="phone" label="Phone" inputMode="tel" hint="A phone, WhatsApp or email is required" />
          <TextField form={form} name="whatsapp" label="WhatsApp" inputMode="tel" />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="city" label="City" />
          <SelectField form={form} name="sectorId" label="Sector" options={options.sectors} noneLabel="Not set" />
          <SelectField form={form} name="leadSourceId" label="Lead source" options={options.sources} noneLabel="Not set" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Requirement</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Services interested in</Label>
            <Controller
              control={form.control}
              name="servicesInterested"
              render={({ field }) => (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Services interested in">
                  {options.services.map((s) => {
                    const on = field.value.includes(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => field.onChange(on ? field.value.filter((v) => v !== s.value) : [...field.value, s.value])}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "bg-card-solid text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </div>
          <TextField form={form} name="approxBudget" label="Approximate budget (₹)" inputMode="decimal" placeholder="25000" />
          <TextField form={form} name="nextFollowUpDate" label="Next follow-up" type="date" />
          <SelectField form={form} name="ownerId" label="Lead owner" options={options.users} noneLabel="Me" />
          <TextAreaField form={form} name="requirementNotes" label="Requirement notes" rows={4} className="sm:col-span-2" />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={leadId ? `/leads/${leadId}` : "/leads"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {leadId ? "Save changes" : "Create lead"}
        </Button>
      </div>

      <DuplicateDialog
        matches={duplicates}
        onCancel={() => setDuplicates(null)}
        onConfirm={() => save(true)}
        confirmLabel={leadId ? "Save anyway" : "Create anyway"}
      />
    </form>
  );
}
