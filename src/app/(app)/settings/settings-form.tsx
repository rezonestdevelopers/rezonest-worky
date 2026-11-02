"use client";

import { useRef, useState, useTransition } from "react";
import { useForm, Controller, type FieldPath, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { settingsSchema, type SettingsInput, type SettingsOutput } from "@/lib/validators/settings";
import { saveSettingsAction, uploadBrandAssetAction } from "@/server/actions/settings";
import { formatDocNumber } from "@/lib/numbering";
import { financialYear, todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

const DAYS = [
  { n: 1, l: "Mon" }, { n: 2, l: "Tue" }, { n: 3, l: "Wed" }, { n: 4, l: "Thu" }, { n: 5, l: "Fri" }, { n: 6, l: "Sat" }, { n: 7, l: "Sun" },
];

export function SettingsForm({ defaults, logoUrl, signatureUrl }: { defaults: SettingsInput; logoUrl: string | null; signatureUrl: string | null }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<SettingsInput, unknown, SettingsOutput>({ resolver: zodResolver(settingsSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, formState, control, watch, setError } = form;
  const errors = formState.errors;

  const onSubmit = (data: SettingsOutput) =>
    startTransition(async () => {
      // send the raw form values; the server validates again (never trust the browser)
      void data;
      const res = await saveSettingsAction(form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        form.reset(form.getValues());
      } else {
        toast.error(res.error);
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k as FieldPath<SettingsInput>, { message: msg });
      }
    });


  const fy = financialYear(todayKey());
  const preview = (fmt: string | undefined) => {
    try {
      return formatDocNumber(fmt ?? "", fy, 1, Number(watch("seqPadding")) || 4);
    } catch {
      return "—";
    }
  };

  const tabErrors = (fields: string[]) => fields.some((f) => f in errors);

  return (
    <form onSubmit={handleSubmit(onSubmit, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Tabs defaultValue="agency">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="agency">Agency{tabErrors(["agencyName", "address", "state", "stateCode", "pincode", "email"]) && <Dot />}</TabsTrigger>
            <TabsTrigger value="tax">GST &amp; Bank{tabErrors(["gstin", "pan", "bankAccountNumber", "bankIfsc", "upiId"]) && <Dot />}</TabsTrigger>
            <TabsTrigger value="numbering">Numbering{tabErrors(["quotationFormat", "proformaFormat", "invoiceFormat", "creditNoteFormat", "seqPadding"]) && <Dot />}</TabsTrigger>
            <TabsTrigger value="defaults">Defaults &amp; Reminders{tabErrors(["defaultGstRate", "paymentTermOptions", "renewalAlertDays", "digestTime", "workingDays"]) && <Dot />}</TabsTrigger>
            <TabsTrigger value="terms">Terms</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agency">
          <Section title="Agency details" description="Printed on offers, invoices and emails.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field form={form} name="agencyName" label="Agency name" className="sm:col-span-2" />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Textarea id="address" rows={3} aria-invalid={!!errors.address} {...register("address")} />
                <FieldNote error={errors.address?.message} />
              </div>
              <Field form={form} name="city" label="City" />
              <Field form={form} name="pincode" label="PIN code" inputMode="numeric" />
              <Field form={form} name="state" label="State" />
              <Field form={form} name="stateCode" label="GST state code" hint="Maharashtra = 27. Decides CGST+SGST vs IGST." inputMode="numeric" />
              <Field form={form} name="email" label="Email" type="email" />
              <Field form={form} name="phone" label="Phone / WhatsApp" />
              <Field form={form} name="website" label="Website" />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="tax">
          <Section title="GST & tax" description="Leave blank until you have them. Format is checked automatically.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field form={form} name="gstin" label="GSTIN" placeholder="27ABCDE1234F1Z5" className="[&_input]:uppercase" />
              <Field form={form} name="pan" label="PAN" placeholder="ABCDE1234F" className="[&_input]:uppercase" />
            </div>
          </Section>
          <Section title="Bank & UPI" description="Shown on invoices with a UPI QR code (Phase 7).">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field form={form} name="bankName" label="Bank name" />
              <Field form={form} name="bankAccountName" label="Account name" />
              <Field form={form} name="bankAccountNumber" label="Account number" inputMode="numeric" autoComplete="off" />
              <Field form={form} name="bankIfsc" label="IFSC" placeholder="HDFC0001234" className="[&_input]:uppercase" />
              <Field form={form} name="bankBranch" label="Branch" />
              <Field form={form} name="upiId" label="UPI ID" placeholder="rezonest@okhdfcbank" />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="numbering">
          <Section title="Document numbers" description={`Use {FY} for the financial year (${fy}) and {SEQ} for the running number. Numbers restart every 1 April and are never reused. Changes apply to future documents only.`}>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ["quotationFormat", "Quotation"],
                ["proformaFormat", "Proforma invoice"],
                ["invoiceFormat", "Tax invoice"],
                ["creditNoteFormat", "Credit note"],
              ] as const).map(([name, label]) => (
                <Field form={form} key={name} name={name} label={label} hint={`Next looks like: ${preview(watch(name))}`} className="[&_input]:font-mono" />
              ))}
              <Field form={form} name="seqPadding" label="Digits in running number" type="number" min={1} max={8} hint="4 → 0001" />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="defaults">
          <Section title="Money defaults">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field form={form} name="defaultGstRate" label="Default GST rate (%)" type="number" step="0.01" min={0} max={28} />
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="gstEnabledByDefault">GST on by default</Label>
                  <p className="text-xs text-muted-foreground">Can still be switched off per invoice.</p>
                </div>
                <Controller control={control} name="gstEnabledByDefault" render={({ field }) => <Switch id="gstEnabledByDefault" checked={field.value} onCheckedChange={field.onChange} />} />
              </div>
              <Field form={form} name="defaultPaymentTermsDays" label="Default payment terms (days)" type="number" min={0} max={180} />
              <Field form={form} name="paymentTermOptions" label="Payment term choices (days)" hint="Comma separated, e.g. 7, 15, 30" />
              <Field form={form} name="offerValidityDays" label="Offer valid for (days)" type="number" min={1} max={180} />
              <Field form={form} name="retainerTaskDay" label="Retainer tasks created on day" type="number" min={1} max={28} hint="Day of month (1–28)" />
            </div>
          </Section>
          <Section title="Reminders & daily digest">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="digestEnabled">Daily email digest</Label>
                  <p className="text-xs text-muted-foreground">Sent to you every morning (Phase 6).</p>
                </div>
                <Controller control={control} name="digestEnabled" render={({ field }) => <Switch id="digestEnabled" checked={field.value} onCheckedChange={field.onChange} />} />
              </div>
              <Field form={form} name="digestTime" label="Digest time (IST)" type="time" />
              <Field form={form} name="renewalAlertDays" label="Renewal alerts (days before expiry)" hint="Comma separated, e.g. 30, 15, 7, 1" />
              <Field form={form} name="approvalWaitDays" label="Alert when waiting for client approval more than (days)" type="number" min={1} />
              <Field form={form} name="dueSoonDays" label="'Due soon' means within (days)" type="number" min={1} />
              <Field form={form} name="adBudgetAlertPercent" label="Ad budget alert at (%)" type="number" min={50} max={100} />
              <Field form={form} name="retainerEndingDays" label="Warn when a retainer ends within (days)" type="number" min={1} />
              <Field form={form} name="shortfallDaysLeft" label="Delivery shortfall alert in last (days) of month" type="number" min={1} max={15} />
            </div>
            <div className="mt-4 space-y-2">
              <Label>Working days</Label>
              <Controller
                control={control}
                name="workingDays"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
                    {DAYS.map((d) => {
                      const on = field.value.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          aria-pressed={on}
                          onClick={() => field.onChange(on ? field.value.filter((x) => x !== d.n) : [...field.value, d.n].sort())}
                          className={cn("h-9 w-12 rounded-md border text-sm font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-card-solid text-muted-foreground hover:bg-accent")}
                        >
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              <FieldNote error={errors.workingDays?.message} />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="terms">
          <Section title="Terms & conditions" description="Printed at the bottom of quotations and invoices.">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="quotationTerms">Quotation terms</Label>
                <Textarea id="quotationTerms" rows={7} {...register("quotationTerms")} placeholder={"1. 50% advance to start work.\n2. GST extra as applicable.\n…"} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoiceTerms">Invoice terms</Label>
                <Textarea id="invoiceTerms" rows={7} {...register("invoiceTerms")} placeholder={"1. Payment due within 15 days.\n2. Interest @18% p.a. on delayed payments.\n…"} />
              </div>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="branding">
          <Section title="Brand colour" description="Used for buttons, highlights and the sidebar. Changes apply to the whole app.">
            <Controller
              control={control}
              name="accentColor"
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <input type="color" aria-label="Brand colour" value={field.value} onChange={(e) => field.onChange(e.target.value)} className="h-10 w-14 cursor-pointer rounded-md border bg-transparent" />
                  <Input value={field.value} onChange={field.onChange} className="w-32 font-mono" aria-label="Brand colour hex" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange("#d7202a")}>Reset to Rezonest red</Button>
                </div>
              )}
            />
            <FieldNote error={errors.accentColor?.message} />
          </Section>
          <div className="grid gap-4 md:grid-cols-2">
            <AssetUpload kind="logo" title="Logo (for documents)" url={logoUrl} hint="PNG with transparent background works best. Max 2 MB." />
            <AssetUpload kind="signature" title="Authorised signature" url={signatureUrl} hint="Scanned signature (PNG/JPG). Kept private. Max 2 MB." />
          </div>
        </TabsContent>
      </Tabs>

      <div className="glass sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg">
        <span className="text-sm text-muted-foreground">{formState.isDirty ? "You have unsaved changes" : "All changes saved"}</span>
        <Button type="submit" disabled={pending || !formState.isDirty}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </Button>
      </div>
    </form>
  );
}

type FieldProps = {
  form: UseFormReturn<SettingsInput, unknown, SettingsOutput>;
  name: FieldPath<SettingsInput>;
  label: string;
  hint?: string;
  className?: string;
} & Omit<React.ComponentProps<"input">, "form" | "name">;

function Field({ form, name, label, hint, className, ...rest }: FieldProps) {
  const error = form.formState.errors[name as keyof typeof form.formState.errors]?.message as string | undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} aria-invalid={!!error} {...form.register(name)} {...rest} />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FieldNote({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <p className="text-xs text-tone-red" role="alert">{error}</p>;
  if (hint) return <p className="text-xs text-muted-foreground">{hint}</p>;
  return null;
}

function Dot() {
  return <span className="ml-1 size-1.5 rounded-full bg-tone-red" aria-label="has errors" />;
}

function AssetUpload({ kind, title, url, hint }: { kind: "logo" | "signature"; title: string; url: string | null; hint: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState(url);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic, auth-protected file
            <img src={preview} alt={title} className="max-h-24 max-w-[90%] object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">Not uploaded yet</span>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.set("kind", kind);
            fd.set("file", file);
            start(async () => {
              const res = await uploadBrandAssetAction(fd);
              if (res.ok) {
                toast.success(res.message ?? "Uploaded");
                setPreview(URL.createObjectURL(file));
              } else toast.error(res.error);
              if (ref.current) ref.current.value = "";
            });
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => ref.current?.click()}>
          {pending ? <Loader2 className="animate-spin" /> : <Upload />} {preview ? "Replace" : "Upload"}
        </Button>
      </CardContent>
    </Card>
  );
}
