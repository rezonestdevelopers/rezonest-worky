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
import { applyFieldErrors, SelectField, TextField } from "@/components/shared/form-fields";
import { statusDef } from "@/lib/status";
import { CAMPAIGN_STATUSES, campaignSchema, type CampaignData, type CampaignInput } from "@/lib/validators/delivery";
import { saveCampaignAction } from "@/server/actions/delivery";

export function CampaignForm({ id, defaults, clients, projects }: { id: string | null; defaults: CampaignInput; clients: { value: string; label: string }[]; projects: { value: string; label: string; clientId: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<CampaignInput, unknown, CampaignData>({ resolver: zodResolver(campaignSchema), defaultValues: defaults });
  const clientId = useWatch({ control: form.control, name: "clientId" });

  const save = () =>
    start(async () => {
      const res = await saveCampaignAction(id, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/ads/${res.id}`);
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
          <SelectField form={form} name="clientId" label="Client" required options={clients} noneLabel="Choose a client" />
          <SelectField form={form} name="projectId" label="Project" options={projects.filter((p) => p.clientId === clientId)} noneLabel="No project" />
          <TextField form={form} name="name" label="Campaign name" required className="sm:col-span-2" hint="Use the same name as in Ads Manager, so uploaded reports match it." />
          <TextField form={form} name="objective" label="Objective" placeholder="e.g. Leads, Sales, Reach" />
          <SelectField form={form} name="status" label="Status" required options={CAMPAIGN_STATUSES.map((s) => ({ value: s, label: statusDef("campaign", s).label }))} />
          <TextField form={form} name="startDate" label="Start date" type="date" required />
          <TextField form={form} name="endDate" label="End date" type="date" />
          <TextField form={form} name="plannedBudget" label="Client's budget (₹)" inputMode="decimal" required hint="The client's money for this campaign, not your fee." />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={id ? `/ads/${id}` : "/ads"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save" : "Add campaign"}</Button>
      </div>
    </form>
  );
}
