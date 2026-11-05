"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import { formatINR } from "@/lib/money/format";
import { computeTotals, type TaxMode } from "@/lib/money/gst";
import { createCreditNoteAction } from "@/server/actions/invoices";

type Line = { id: string; description: string; gstRate: string; left: string };

export function CreditNoteForm({ invoiceId, today, minDate, taxMode, balance, lines }: { invoiceId: string; today: string; minDate: string; taxMode: string; balance: string; lines: Line[] }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const totals = useMemo(() => {
    try {
      return computeTotals(lines.map((l) => ({ quantity: 1, rate: (amounts[l.id] ?? "").replace(/[₹,\s]/g, "") || "0", gstRate: l.gstRate })), taxMode as TaxMode);
    } catch {
      return null;
    }
  }, [amounts, lines, taxMode]);

  const save = () =>
    start(async () => {
      setError(undefined);
      const res = await createCreditNoteAction({ invoiceId, date, reason, lines: lines.map((l) => ({ itemId: l.id, taxable: amounts[l.id] ?? "" })) });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/invoices/${invoiceId}`);
      } else setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error);
    });

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="cnDate">Date</Label>
            <Input id="cnDate" type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnReason">Reason</Label>
            <Textarea id="cnReason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Enter how much to credit on each line, before GST. GST is added at that line&apos;s rate.</p>
          {lines.map((l) => (
            <div key={l.id} className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Label htmlFor={`cn-${l.id}`} className="block font-normal">
                {l.description}
                <span className="block text-xs text-muted-foreground">Up to {formatINR(l.left)}</span>
              </Label>
              <div className="flex gap-1.5">
                <Input id={`cn-${l.id}`} inputMode="decimal" value={amounts[l.id] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setAmounts((a) => ({ ...a, [l.id]: l.left }))}>Full</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t pt-3 text-right text-sm">
          <p className="text-muted-foreground">Unpaid on this invoice: <span className="tabular-nums">{formatINR(balance)}</span></p>
          <p className="text-base font-semibold">Credit note total: <span className="tabular-nums" data-testid="credit-total">{totals ? formatINR(totals.grandTotal) : "—"}</span></p>
        </div>
        <FieldNote error={error} />
        <div className="flex justify-end">
          <Button disabled={pending} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Create credit note</Button>
        </div>
      </CardContent>
    </Card>
  );
}
