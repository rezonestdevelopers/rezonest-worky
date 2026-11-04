"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { ASSET_KINDS, assetKindLabel } from "@/lib/renewals";
import { assetSchema, type AssetData, type AssetInput } from "@/lib/validators/delivery";
import { saveAssetAction } from "@/server/actions/delivery";

export function AssetForm({ id, defaults, clients }: { id: string | null; defaults: AssetInput; clients: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<AssetInput, unknown, AssetData>({ resolver: zodResolver(assetSchema), defaultValues: defaults });
  const kind = useWatch({ control: form.control, name: "kind" });

  const save = () =>
    start(async () => {
      const res = await saveAssetAction(id, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/renewals/${res.id}`);
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
          <SelectField form={form} name="kind" label="Type" required options={ASSET_KINDS.map((k) => ({ value: k, label: assetKindLabel(k) }))} />
          <TextField form={form} name="name" label={kind === "DOMAIN" ? "Domain" : "Name"} required className="sm:col-span-2" placeholder={kind === "DOMAIN" ? "example.com" : "e.g. example.com hosting"} />
          <TextField form={form} name="provider" label={kind === "DOMAIN" ? "Registrar" : "Provider"} />
          <TextField form={form} name="plan" label="Plan" />
          <TextField form={form} name="purchaseDate" label="Purchase date" type="date" />
          <TextField form={form} name="expiryDate" label="Expiry date" type="date" required />
          {kind === "BUSINESS_EMAIL" && <TextField form={form} name="emailAccounts" label="Email accounts" inputMode="numeric" />}
          <TextField form={form} name="costPrice" label="Our cost (₹)" inputMode="decimal" required />
          <TextField form={form} name="renewalPrice" label="Renewal price (₹)" inputMode="decimal" required hint="What you charge the client, before GST." />
          <div className="flex items-center justify-between gap-3 self-start rounded-lg border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="autoRenew">Auto-renew is on with the provider</Label>
              <p className="text-xs text-muted-foreground">Just a note for you. This app doesn&apos;t renew anything by itself.</p>
            </div>
            <Controller control={form.control} name="autoRenew" render={({ field }) => <Switch id="autoRenew" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          <TextField form={form} name="credentialsLocation" label="Where the login details are kept" className="sm:col-span-2" placeholder="e.g. Agency password manager → Clients" hint="Say where they're kept. Never type a password into this app." />
          <TextAreaField form={form} name="notes" label="Notes" rows={3} className="sm:col-span-2" />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={id ? `/renewals/${id}` : "/renewals"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save" : "Add item"}</Button>
      </div>
    </form>
  );
}
