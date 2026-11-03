"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyFieldErrors, FieldNote, NONE, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { INDIA_STATES } from "@/lib/india-states";
import { formatINR } from "@/lib/money/format";
import { computeTotals, determineTaxMode } from "@/lib/money/gst";
import { humanize } from "@/lib/status";
import { BILLING_TYPES } from "@/lib/validators/catalogue";
import { CONTENT_FORMATS, offerSchema, templateSchema, type OfferInput } from "@/lib/validators/offer";
import { saveOfferAction, saveTemplateAction } from "@/server/actions/offers";
import type { OfferFormOptions } from "@/server/queries/offers";

export type OfferFormValues = OfferInput & { templateName?: string };
type Mode = { kind: "offer"; offerId: string | null } | { kind: "template"; templateId: string | null };
type Form = UseFormReturn<OfferFormValues, unknown, OfferFormValues>;

const FORMAT_LABEL: Record<string, string> = { STATIC_POST: "Posts", CAROUSEL: "Carousels", REEL: "Reels", STORY: "Stories", VIDEO: "Videos" };
const STATE_OPTIONS = INDIA_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));
const blankDeliverables = () => CONTENT_FORMATS.map((format) => ({ format, qtyPerMonth: 0 }));

export function OfferForm({ mode, defaults, options }: { mode: Mode; defaults: OfferFormValues; options: OfferFormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isTemplate = mode.kind === "template";
  const form = useForm<OfferFormValues, unknown, OfferFormValues>({
    resolver: zodResolver((isTemplate ? templateSchema : offerSchema) as typeof offerSchema) as never,
    defaultValues: defaults,
  });
  const [recipientKind, setRecipientKind] = useState<"client" | "lead">(defaults.leadId && !defaults.clientId ? "lead" : "client");
  const items = useFieldArray({ control: form.control, name: "items" });
  const milestones = useFieldArray({ control: form.control, name: "milestones" });
  const errors = form.formState.errors as Record<string, { message?: string; root?: { message?: string } } | undefined>;

  const save = () =>
    start(async () => {
      const values = form.getValues();
      const res = isTemplate
        ? await saveTemplateAction(mode.templateId, { ...values, templateName: values.templateName ?? "" })
        : await saveOfferAction(mode.offerId, { ...values, clientId: recipientKind === "client" ? values.clientId : "", leadId: recipientKind === "lead" ? values.leadId : "" });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(isTemplate ? "/offers/templates" : `/offers/${res.id}`);
      } else {
        toast.error(res.fieldErrors?.recipient ?? res.fieldErrors?.milestones ?? res.error);
        applyFieldErrors(form, res);
      }
    });

  const onlyActiveRecipient = () => {
    if (recipientKind === "client") form.setValue("leadId", "");
    else form.setValue("clientId", "");
  };

  const cancelHref = isTemplate ? "/offers/templates" : mode.offerId ? `/offers/${mode.offerId}` : "/offers";

  return (
    <form
      onSubmit={(e) => {
        onlyActiveRecipient();
        void form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))(e);
      }}
      className="space-y-4"
      noValidate
    >
      <Card>
        <CardHeader><CardTitle>{isTemplate ? "Template" : "Offer details"}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {isTemplate && <TextField form={form} name="templateName" label="Template name" required className="sm:col-span-2" />}
          {!isTemplate && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Who is this for?</Label>
              <Tabs value={recipientKind} onValueChange={(v) => setRecipientKind(v as "client" | "lead")}>
                <TabsList>
                  <TabsTrigger value="client">A client</TabsTrigger>
                  <TabsTrigger value="lead">A lead</TabsTrigger>
                </TabsList>
              </Tabs>
              {recipientKind === "client" ? (
                <SelectField form={form} name="clientId" label="Client" required options={options.clients} />
              ) : (
                <SelectField form={form} name="leadId" label="Lead" required options={options.leads} />
              )}
              <FieldNote error={errors.recipient?.message} />
            </div>
          )}
          <TextField form={form} name="title" label="Offer title" required className="sm:col-span-2" placeholder="e.g. Social Media & Meta Ads retainer" />
          {!isTemplate && <TextField form={form} name="offerDate" label="Offer date" type="date" required />}
          {!isTemplate && <TextField form={form} name="validUntil" label="Valid until" type="date" required hint={`Usually ${options.validityDays} days`} />}
          <TextField form={form} name="durationMonths" label="Duration (months)" type="number" min={1} hint="Leave blank for one-off work" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              items.append({
                serviceId: "", subServiceId: "", description: "", billingType: "ONE_TIME", quantity: "1", unit: "unit", rate: "",
                discountType: "", discountValue: "", gstRate: options.defaultGstRate, sacCode: "", durationMonths: "", deliverables: blankDeliverables(),
              })
            }
          >
            <Plus /> Add item
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.fields.length === 0 && <p className="text-sm text-muted-foreground">Add at least one item.</p>}
          <FieldNote error={errors.items?.message ?? errors.items?.root?.message} />
          {items.fields.map((f, i) => (
            <ItemRow key={f.id} form={form} index={i} options={options} onRemove={() => items.remove(i)} />
          ))}
        </CardContent>
      </Card>

      <Totals form={form} options={options} recipientKind={recipientKind} isTemplate={isTemplate} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payment milestones</CardTitle>
            <CardDescription>Optional. If you add any, they must total 100%.</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => milestones.replace([{ name: "Advance", percent: "50" }, { name: "On design approval", percent: "30" }, { name: "Before launch", percent: "20" }])}
            >
              Use 50 / 30 / 20
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => milestones.append({ name: "", percent: "" })}><Plus /> Add</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <FieldNote error={errors.milestones?.message ?? errors.milestones?.root?.message} />
          {milestones.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input className="min-w-0 flex-1" placeholder="Milestone" aria-label={`Milestone ${i + 1} name`} {...form.register(`milestones.${i}.name`)} />
              <Input className="w-20" inputMode="decimal" placeholder="%" aria-label={`Milestone ${i + 1} percent`} {...form.register(`milestones.${i}.percent`)} />
              <Button type="button" variant="ghost" size="icon" onClick={() => milestones.remove(i)} aria-label={`Remove milestone ${i + 1}`}><Trash2 /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <TextAreaField form={form} name="paymentTerms" label="Payment terms" rows={2} placeholder="e.g. Monthly in advance, due within 15 days of invoice" />
          <TextAreaField form={form} name="terms" label="Terms & conditions" rows={5} hint="Filled from Settings. Changes here apply to this offer only." />
          <TextAreaField form={form} name="notes" label="Notes" rows={2} hint="The client sees these notes." />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={cancelHref}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {isTemplate ? "Save template" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}

function ItemRow({ form, index, options, onRemove }: { form: Form; index: number; options: OfferFormOptions; onRemove: () => void }) {
  const serviceId = useWatch({ control: form.control, name: `items.${index}.serviceId` });
  const billing = useWatch({ control: form.control, name: `items.${index}.billingType` });
  const discountType = useWatch({ control: form.control, name: `items.${index}.discountType` });
  const service = options.services.find((s) => s.id === serviceId);
  const itemErrors = (form.formState.errors.items as unknown as Record<string, { message?: string }>[] | undefined)?.[index];
  const set = (field: "description" | "billingType" | "unit" | "rate" | "gstRate" | "sacCode", value: string) =>
    form.setValue(`items.${index}.${field}` as never, value as never, { shouldValidate: form.formState.isSubmitted });

  const pickService = (id: string) => {
    const s = options.services.find((x) => x.id === id);
    form.setValue(`items.${index}.serviceId`, id);
    form.setValue(`items.${index}.subServiceId`, "");
    if (!s) return;
    set("description", s.name);
    set("billingType", s.billingType);
    set("unit", s.unit);
    set("rate", s.price);
    set("gstRate", s.gstRate);
    set("sacCode", s.sacCode);
  };
  const pickSub = (id: string) => {
    const sub = service?.subs.find((x) => x.id === id);
    form.setValue(`items.${index}.subServiceId`, id);
    if (!sub || !service) return;
    set("description", `${service.name}: ${sub.name}`);
    set("billingType", sub.billingType ?? service.billingType);
    set("unit", sub.unit ?? service.unit);
    set("rate", sub.price ?? service.price);
  };

  return (
    <section aria-label={`Item ${index + 1}`} className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Service</Label>
          <Select value={serviceId || NONE} onValueChange={(v) => pickService(v === NONE ? "" : v)}>
            <SelectTrigger className="w-full" aria-label={`Item ${index + 1} service`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Custom item</SelectItem>
              {options.services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Sub-service</Label>
          <Controller
            control={form.control}
            name={`items.${index}.subServiceId`}
            render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => pickSub(v === NONE ? "" : v)} disabled={!service?.subs.length}>
                <SelectTrigger className="w-full" aria-label={`Item ${index + 1} sub-service`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {service?.subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Input aria-label={`Item ${index + 1} description`} aria-invalid={!!itemErrors?.description} {...form.register(`items.${index}.description`)} />
        <FieldNote error={itemErrors?.description?.message} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 space-y-1.5 md:col-span-1">
          <Label>Billing</Label>
          <Controller
            control={form.control}
            name={`items.${index}.billingType`}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full" aria-label={`Item ${index + 1} billing`}><SelectValue /></SelectTrigger>
                <SelectContent>{BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{humanize(b)}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Qty</Label>
          <Input inputMode="decimal" aria-label={`Item ${index + 1} quantity`} aria-invalid={!!itemErrors?.quantity} {...form.register(`items.${index}.quantity`)} />
          <FieldNote error={itemErrors?.quantity?.message} />
        </div>
        <div className="space-y-1.5">
          <Label>Unit</Label>
          <Input aria-label={`Item ${index + 1} unit`} aria-invalid={!!itemErrors?.unit} {...form.register(`items.${index}.unit`)} />
          <FieldNote error={itemErrors?.unit?.message} />
        </div>
        <div className="space-y-1.5">
          <Label>Rate (₹)</Label>
          <Input inputMode="decimal" aria-label={`Item ${index + 1} rate`} aria-invalid={!!itemErrors?.rate} {...form.register(`items.${index}.rate`)} />
          <FieldNote error={itemErrors?.rate?.message} />
        </div>
        <div className="space-y-1.5">
          <Label>Discount</Label>
          <Controller
            control={form.control}
            name={`items.${index}.discountType`}
            render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                <SelectTrigger className="w-full" aria-label={`Item ${index + 1} discount type`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  <SelectItem value="PERCENT">%</SelectItem>
                  <SelectItem value="AMOUNT">₹</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Discount value</Label>
          <Input inputMode="decimal" disabled={!discountType} aria-label={`Item ${index + 1} discount value`} aria-invalid={!!itemErrors?.discountValue} {...form.register(`items.${index}.discountValue`)} />
          <FieldNote error={itemErrors?.discountValue?.message} />
        </div>
        <div className="space-y-1.5">
          <Label>GST %</Label>
          <Input inputMode="decimal" aria-label={`Item ${index + 1} GST rate`} aria-invalid={!!itemErrors?.gstRate} {...form.register(`items.${index}.gstRate`)} />
          <FieldNote error={itemErrors?.gstRate?.message} />
        </div>
        <div className="space-y-1.5">
          <Label>Months</Label>
          <Input type="number" min={1} aria-label={`Item ${index + 1} months`} aria-invalid={!!itemErrors?.durationMonths} {...form.register(`items.${index}.durationMonths`)} />
          <FieldNote error={itemErrors?.durationMonths?.message} />
        </div>
      </div>
      {billing === "MONTHLY_RETAINER" && (
        <div className="space-y-1.5">
          <Label>Monthly package (used for retainer tasks later)</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {CONTENT_FORMATS.map((format, j) => (
              <label key={format} className="space-y-1 text-xs text-muted-foreground">
                {FORMAT_LABEL[format]}
                <Input type="number" min={0} aria-label={`Item ${index + 1} ${FORMAT_LABEL[format]} per month`} {...form.register(`items.${index}.deliverables.${j}.qtyPerMonth`)} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}><Trash2 /> Remove item</Button>
      </div>
    </section>
  );
}

function Totals({ form, options, recipientKind, isTemplate }: { form: Form; options: OfferFormOptions; recipientKind: "client" | "lead"; isTemplate: boolean }) {
  const items = useWatch({ control: form.control, name: "items" });
  const gstEnabled = useWatch({ control: form.control, name: "gstEnabled" });
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const supply = useWatch({ control: form.control, name: "supplyStateCode" });
  const client = recipientKind === "client" ? options.clients.find((c) => c.value === clientId) : undefined;
  const showState = isTemplate || recipientKind === "lead";

  const mode = determineTaxMode({
    gstEnabled,
    agencyStateCode: options.agencyStateCode,
    clientStateCode: client ? client.stateCode : supply || options.agencyStateCode,
    clientCountry: client?.abroad ? "Abroad" : "India",
  });
  // Same calculator as the server. Half-typed numbers just show nothing until they're valid.
  const totals = useMemo(() => {
    try {
      return computeTotals(
        (items ?? []).map((i) => ({
          quantity: i.quantity || 0,
          rate: String(i.rate ?? "").replace(/[₹,\s]/g, "") || 0,
          discountType: i.discountType || null,
          discountValue: String(i.discountValue ?? "").replace(/[₹,\s]/g, "") || 0,
          gstRate: i.gstRate || 0,
        })),
        mode,
      );
    } catch {
      return null;
    }
  }, [items, mode]);

  const label = {
    INTRA_STATE: "CGST + SGST (same state as you)",
    INTER_STATE: "IGST (different state)",
    NO_GST: "No GST",
    EXPORT: "Export of services, no GST",
  }[mode];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Totals</CardTitle>
          <CardDescription>
            {label}
            {client && ` · ${client.abroad ? "client is outside India" : `client's state: ${client.state}`}`}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="gstEnabled">Charge GST</Label>
            <Controller control={form.control} name="gstEnabled" render={({ field }) => <Switch id="gstEnabled" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          {showState && !isTemplate && <SelectField form={form} name="supplyStateCode" label="Place of supply" options={STATE_OPTIONS} hint="Leads have no state saved, so choose it here" />}
        </div>
        {totals ? (
          <dl className="space-y-1 text-sm" data-testid="form-totals">
            <TotalRow label="Subtotal" value={formatINR(totals.subtotal)} />
            {!totals.discountTotal.isZero() && <TotalRow label="Discount" value={`- ${formatINR(totals.discountTotal)}`} />}
            <TotalRow label="Taxable value" value={formatINR(totals.taxableTotal)} />
            {mode === "INTRA_STATE" && <TotalRow label="CGST" value={formatINR(totals.cgstTotal)} />}
            {mode === "INTRA_STATE" && <TotalRow label="SGST" value={formatINR(totals.sgstTotal)} />}
            {mode === "INTER_STATE" && <TotalRow label="IGST" value={formatINR(totals.igstTotal)} />}
            {!totals.roundOff.isZero() && <TotalRow label="Round-off" value={`${totals.roundOff.isNegative() ? "- " : ""}${formatINR(totals.roundOff.abs())}`} />}
            <div className="flex justify-between border-t-2 border-primary pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(totals.grandTotal)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Check the amounts above to see the total.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
