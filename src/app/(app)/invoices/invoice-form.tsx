"use client";

import { useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyFieldErrors, FieldNote, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { formatINR } from "@/lib/money/format";
import { computeTotals, determineTaxMode, type LineInput } from "@/lib/money/gst";
import { invoiceSchema, type InvoiceInput } from "@/lib/validators/invoice";
import { saveInvoiceAction } from "@/server/actions/invoices";
import type { InvoiceFormOptions } from "./form-values";

type Line = InvoiceInput["items"][number];
const num = (v: unknown) => String(v ?? "").replace(/[₹,\s]/g, "") || "0";
const nativeSelect = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs";

export function InvoiceForm({ invoiceId, defaults, options }: { invoiceId: string | null; defaults: InvoiceInput; options: InvoiceFormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<InvoiceInput>({ resolver: zodResolver(invoiceSchema) as never, defaultValues: defaults });
  const items = useFieldArray({ control: form.control, name: "items", keyName: "rowKey" });
  const watched = useWatch({ control: form.control });
  const lines = (watched.items ?? []) as Line[];
  const client = options.clients.find((c) => c.value === watched.clientId);
  const gstEnabled = watched.gstEnabled ?? true;
  const projects = options.projects.filter((p) => p.clientId === watched.clientId);

  useEffect(() => {
    const current = form.getValues("projectId");
    if (current && !projects.some((p) => p.value === current)) form.setValue("projectId", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the client changes
  }, [watched.clientId]);

  const mode = useMemo(() => determineTaxMode({ gstEnabled, agencyStateCode: options.agencyStateCode, clientStateCode: client?.stateCode ?? options.agencyStateCode, clientCountry: client?.country ?? "India" }), [gstEnabled, client, options.agencyStateCode]);
  const key = JSON.stringify(lines.map((l) => [l.quantity, l.rate, l.discountType, l.discountValue, l.gstRate]));
  const totals = useMemo(() => {
    try {
      const input: LineInput[] = lines.map((l) => ({ quantity: num(l.quantity), rate: num(l.rate), discountType: (l.discountType || null) as LineInput["discountType"], discountValue: num(l.discountValue), gstRate: num(l.gstRate) }));
      return computeTotals(input, mode);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` holds the lines' values
  }, [key, mode]);

  // The server checks the form as typed, so it gets the typed values, not the cleaned-up ones.
  const save = () =>
    start(async () => {
      const res = await saveInvoiceAction(invoiceId, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/invoices/${res.id}`);
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  const itemErrors = form.formState.errors.items as unknown as (Record<string, { message?: string } | undefined> | undefined)[] | { message?: string } | undefined;
  const lineError = (i: number, name: string) => (Array.isArray(itemErrors) ? itemErrors[i]?.[name]?.message : undefined);

  const pickService = (i: number, id: string) => {
    form.setValue(`items.${i}.serviceId`, id);
    const service = options.services.find((s) => s.value === id);
    if (!service) return;
    if (!String(form.getValues(`items.${i}.description`) ?? "").trim()) form.setValue(`items.${i}.description`, service.label);
    if (!String(form.getValues(`items.${i}.rate`) ?? "").trim()) form.setValue(`items.${i}.rate`, service.rate);
    form.setValue(`items.${i}.unit`, service.unit);
    form.setValue(`items.${i}.gstRate`, service.gstRate);
    if (service.sacCode) form.setValue(`items.${i}.sacCode`, service.sacCode);
  };

  const taxLabel = mode === "INTRA_STATE" ? "CGST + SGST, because this client is in your state" : mode === "INTER_STATE" ? "IGST, because this client is in another state" : mode === "EXPORT" ? "No GST: this client is outside India" : "No GST on this invoice";

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField form={form} name="clientId" label="Client" required options={options.clients} />
          <SelectField form={form} name="projectId" label="Project" noneLabel="No project" options={projects} />
          <SelectField form={form} name="type" label="Type" required options={[{ value: "TAX", label: "Tax invoice" }, { value: "PROFORMA", label: "Proforma invoice" }]} hint="A proforma asks for money before the work. It isn't a tax invoice, and can be converted later." />
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="gstEnabled">Charge GST</Label>
              <p className="text-xs text-muted-foreground">{taxLabel}</p>
            </div>
            <Switch id="gstEnabled" checked={gstEnabled} onCheckedChange={(v) => form.setValue("gstEnabled", v)} />
          </div>
          <TextField
            form={form}
            name="invoiceDate"
            label="Invoice date"
            type="date"
            required
          />
          <TextField form={form} name="dueDate" label="Due date" type="date" required hint={`Usually ${options.defaultTermsDays} days after the invoice date`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Lines</CardTitle>
            <CardDescription>Rates are before GST.{options.hasGstin ? "" : " A GST tax invoice can't be issued until your GSTIN is in Settings."}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => items.append({ serviceId: "", description: "", sacCode: "", quantity: "1", unit: "", rate: "", discountType: "", discountValue: "", gstRate: options.defaultGstRate })}>
            <Plus /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {typeof itemErrors === "object" && itemErrors !== null && !Array.isArray(itemErrors) && <FieldNote error={itemErrors.message} />}
          {items.fields.map((field, i) => {
            const id = (name: string) => `line-${i}-${name}`;
            const line = totals?.lines[i];
            return (
              <div key={field.rowKey} className="space-y-3 rounded-lg border p-3" data-testid="invoice-line">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <div className="space-y-1.5">
                    <Label htmlFor={id("service")}>Service</Label>
                    <select id={id("service")} className={nativeSelect} value={lines[i]?.serviceId ?? ""} onChange={(e) => pickService(i, e.target.value)}>
                      <option value="">None</option>
                      {options.services.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("description")}>Description<span className="text-tone-red" aria-hidden>*</span></Label>
                    <Input id={id("description")} aria-invalid={!!lineError(i, "description")} {...form.register(`items.${i}.description`)} />
                    <FieldNote error={lineError(i, "description")} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <div className="space-y-1.5">
                    <Label htmlFor={id("sac")}>SAC code</Label>
                    <Input id={id("sac")} inputMode="numeric" aria-invalid={!!lineError(i, "sacCode")} {...form.register(`items.${i}.sacCode`)} />
                    <FieldNote error={lineError(i, "sacCode")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("qty")}>Quantity</Label>
                    <Input id={id("qty")} inputMode="decimal" aria-invalid={!!lineError(i, "quantity")} {...form.register(`items.${i}.quantity`)} />
                    <FieldNote error={lineError(i, "quantity")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("rate")}>Rate (₹)</Label>
                    <Input id={id("rate")} inputMode="decimal" aria-invalid={!!lineError(i, "rate")} {...form.register(`items.${i}.rate`)} />
                    <FieldNote error={lineError(i, "rate")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("discountType")}>Discount in</Label>
                    <select id={id("discountType")} className={nativeSelect} {...form.register(`items.${i}.discountType`)}>
                      <option value="">None</option>
                      <option value="PERCENT">%</option>
                      <option value="AMOUNT">₹</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("discount")}>Discount</Label>
                    <Input id={id("discount")} inputMode="decimal" aria-invalid={!!lineError(i, "discountValue")} {...form.register(`items.${i}.discountValue`)} />
                    <FieldNote error={lineError(i, "discountValue")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("gst")}>GST %</Label>
                    <Input id={id("gst")} inputMode="decimal" disabled={!gstEnabled} aria-invalid={!!lineError(i, "gstRate")} {...form.register(`items.${i}.gstRate`)} />
                    <FieldNote error={lineError(i, "gstRate")} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">{line ? `Taxable ${formatINR(line.taxable)} · Line total ${formatINR(line.total)}` : "Check this line"}</span>
                  {items.fields.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => items.remove(i)} aria-label={`Remove line ${i + 1}`}><Trash2 /> Remove</Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            <TextAreaField form={form} name="terms" label="Terms" rows={4} />
            <TextAreaField form={form} name="notes" label="Notes" rows={2} />
          </div>
          {totals && (
            <dl className="space-y-1 self-start text-sm" data-testid="invoice-totals">
              <Row label="Subtotal" value={formatINR(totals.subtotal)} />
              {!totals.discountTotal.isZero() && <Row label="Discount" value={`−${formatINR(totals.discountTotal)}`} />}
              <Row label="Taxable value" value={formatINR(totals.taxableTotal)} />
              {mode === "INTRA_STATE" && <><Row label="CGST" value={formatINR(totals.cgstTotal)} /><Row label="SGST" value={formatINR(totals.sgstTotal)} /></>}
              {mode === "INTER_STATE" && <Row label="IGST" value={formatINR(totals.igstTotal)} />}
              {!totals.roundOff.isZero() && <Row label="Round-off" value={formatINR(totals.roundOff)} />}
              <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums" data-testid="invoice-total">{formatINR(totals.grandTotal)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild><Link href={invoiceId ? `/invoices/${invoiceId}` : "/invoices"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save draft</Button>
      </div>
    </form>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);
