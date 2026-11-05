"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import { formatDateKey } from "@/lib/dates";
import { paymentModeLabel, suggestAllocations } from "@/lib/invoice-rules";
import { sum, toDecimal } from "@/lib/money/decimal";
import { formatINR } from "@/lib/money/format";
import { PAYMENT_MODES } from "@/lib/validators/invoice";
import { getClientOpenItemsAction, recordPaymentAction } from "@/server/actions/invoices";

type Open = Awaited<ReturnType<typeof getClientOpenItemsAction>>;
const clean = (v: string) => v.replace(/[₹,\s]/g, "");
const safe = (v: string) => (/^\d+(\.\d{0,2})?$/.test(clean(v)) ? clean(v) : "0");

export function PaymentForm({ today, clients, initialClient, focusInvoice }: { today: string; clients: { value: string; label: string }[]; initialClient: string; focusInvoice: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initialClient);
  const [open, setOpen] = useState<Open | null>(null);
  const [loading, setLoading] = useState(!!initialClient);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof PAYMENT_MODES)[number]>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [tdsSection, setTdsSection] = useState("");
  const [notes, setNotes] = useState("");
  const [cash, setCash] = useState<Record<string, string>>({});
  const [tds, setTds] = useState<Record<string, string>>({});
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    getClientOpenItemsAction(clientId).then((res) => {
      if (live) {
        setOpen(res);
        setLoading(false);
      }
    }).catch(() => {
      if (live) {
        setError("Couldn't load this client's invoices. Please try again.");
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const invoices = useMemo(() => {
    const rows = open?.invoices ?? [];
    return focusInvoice ? [...rows].sort((a, b) => Number(b.id === focusInvoice) - Number(a.id === focusInvoice)) : rows;
  }, [open, focusInvoice]);
  const appliedCash = sum(invoices.map((i) => safe(cash[i.id] ?? "")));
  const appliedTds = sum(invoices.map((i) => safe(tds[i.id] ?? "")));
  const left = toDecimal(safe(amount)).minus(appliedCash);

  const autoFill = () => {
    const filled = suggestAllocations(safe(amount), invoices.map((i) => ({ id: i.id, balance: toDecimal(i.balance).minus(toDecimal(safe(tds[i.id] ?? ""))) })));
    setCash(Object.fromEntries(filled.map((f) => [f.invoiceId, f.amount])));
  };

  const chooseClient = (id: string) => {
    setClientId(id);
    setOpen(null);
    setLoading(true);
    setError(undefined);
    setCash({});
    setTds({});
  };

  const save = () =>
    start(async () => {
      setError(undefined);
      setFieldErrors({});
      const res = await recordPaymentAction({
        clientId, date, amount, tdsAmount: appliedTds.toFixed(2), tdsSection, mode, reference, notes, allowDuplicate,
        allocations: invoices.map((i) => ({ invoiceId: i.id, amount: cash[i.id] ?? "", tdsAmount: tds[i.id] ?? "" })),
      });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/payments/${res.id}`);
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="payClient">Client<span className="text-tone-red" aria-hidden>*</span></Label>
            <Select value={clientId} onValueChange={chooseClient}>
              <SelectTrigger id="payClient" className="w-full"><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldNote error={fieldErrors.clientId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payAmount">Amount received (₹)<span className="text-tone-red" aria-hidden>*</span></Label>
            <Input id="payAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!fieldErrors.amount} />
            <FieldNote error={fieldErrors.amount} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payDate">Date<span className="text-tone-red" aria-hidden>*</span></Label>
            <Input id="payDate" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            <FieldNote error={fieldErrors.date} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payMode">Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger id="payMode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{paymentModeLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payRef">Reference no.</Label>
            <Input id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR, cheque no." />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="payNotes">Notes</Label>
            <Textarea id="payNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {clientId && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Apply to invoices</CardTitle>
              <CardDescription>TDS is what the client held back for the government. It counts toward the invoice, on top of the money received.</CardDescription>
            </div>
            {invoices.length > 0 && <Button type="button" variant="outline" size="sm" onClick={autoFill}><Wand2 /> Fill oldest first</Button>}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Loading invoices…</p>}
            {!loading && invoices.length === 0 && <p className="text-sm text-muted-foreground">This client has no invoices waiting for payment. The money will be saved as their advance.</p>}
            {invoices.map((i) => (
              <div key={i.id} className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]" data-testid="allocation-row">
                <div className="min-w-0 text-sm">
                  <Link href={`/invoices/${i.id}`} target="_blank" className="font-medium hover:underline">{i.number}</Link>
                  <div className="text-xs text-muted-foreground">Due {formatDateKey(i.dueDate)} · Owes <span className="tabular-nums">{formatINR(i.balance)}</span></div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`cash-${i.id}`} className="text-xs">Applied (₹)</Label>
                  <Input id={`cash-${i.id}`} inputMode="decimal" value={cash[i.id] ?? ""} onChange={(e) => setCash((c) => ({ ...c, [i.id]: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`tds-${i.id}`} className="text-xs">TDS (₹)</Label>
                  <Input id={`tds-${i.id}`} inputMode="decimal" value={tds[i.id] ?? ""} onChange={(e) => setTds((t) => ({ ...t, [i.id]: e.target.value }))} />
                </div>
              </div>
            ))}
            {appliedTds.greaterThan(0) && (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="tdsSection">TDS section</Label>
                <Input id="tdsSection" value={tdsSection} onChange={(e) => setTdsSection(e.target.value)} placeholder="e.g. 194J" />
              </div>
            )}
            <dl className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Applied to invoices</dt><dd className="tabular-nums">{formatINR(appliedCash)}</dd></div>
              {appliedTds.greaterThan(0) && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">TDS</dt><dd className="tabular-nums">{formatINR(appliedTds)}</dd></div>}
              <div className="flex justify-between gap-3 font-medium">
                <dt>{left.isNegative() ? "Applied more than received" : "Saved as advance"}</dt>
                <dd className={left.isNegative() ? "text-tone-red tabular-nums" : "tabular-nums"} data-testid="advance-left">{formatINR(left.abs())}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {error?.includes("already recorded") && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor="allowDuplicate">This really is a second payment</Label>
          <Switch id="allowDuplicate" checked={allowDuplicate} onCheckedChange={setAllowDuplicate} />
        </div>
      )}
      <FieldNote error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href="/payments">Cancel</Link></Button>
        <Button disabled={pending || !clientId} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save payment</Button>
      </div>
    </div>
  );
}
