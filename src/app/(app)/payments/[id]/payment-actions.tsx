"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, Stamp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FieldNote } from "@/components/shared/form-fields";
import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { applyAdvanceAction, convertAndApplyAction, removeAllocationAction, voidPaymentAction } from "@/server/actions/invoices";
import { ReasonButton } from "@/app/(app)/invoices/open-draft-button";

export const VoidPaymentButton = ({ id }: { id: string }) => (
  <ReasonButton label="Void payment" icon={<Ban />} title="Void this payment?" description="For a mistaken entry or a bounced cheque. It stays on record, marked void, and its invoices owe that amount again." confirmLabel="Void payment" action={(reason) => voidPaymentAction(id, reason)} />
);

export const RemoveAllocationButton = ({ paymentId, invoiceId, number }: { paymentId: string; invoiceId: string; number: string }) => (
  <ConfirmButton variant="ghost" label="Remove" icon={<X />} ariaLabel={`Remove from ${number}`} title={`Take this payment off ${number}?`} description="The invoice owes this amount again and the money becomes the client's advance. Any TDS against this invoice is cleared from the payment." confirmLabel="Remove" action={() => removeAllocationAction({ paymentId, invoiceId })} />
);

export function ConvertProformaPrompt({ paymentId, paymentDate, left, proformas }: { paymentId: string; paymentDate: string; left: string; proformas: { id: string; number: string; total: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <Card className="border-tone-amber/50" data-testid="convert-prompt">
      <CardHeader>
        <div>
          <CardTitle>This client has an open proforma</CardTitle>
          <CardDescription>Convert it into a tax invoice dated {formatDateKey(paymentDate)}, the day the money arrived, and apply the {formatINR(left)} advance to it. Please confirm GST on advances with your CA.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {proformas.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{p.number} · <span className="tabular-nums">{formatINR(p.total)}</span></span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const res = await convertAndApplyAction({ proformaId: p.id, paymentId });
                  if (res.ok) {
                    toast.success(res.message ?? "Done");
                    router.push(`/invoices/${res.id}`);
                  } else setError(res.error);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Stamp />} Convert and apply
            </Button>
          </div>
        ))}
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}

export function ApplyAdvanceForm({ paymentId, left, invoices }: { paymentId: string; left: string; invoices: { id: string; number: string; balance: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string>();
  const chosen = invoices.find((i) => i.id === invoiceId);
  const suggested = chosen ? (Number(chosen.balance) < Number(left) ? chosen.balance : left) : "";
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Apply the advance</CardTitle>
          <CardDescription>{formatINR(left)} of this payment isn&apos;t on any invoice yet.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="applyInvoice">Invoice</Label>
          <select id="applyInvoice" className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.number} (owes {formatINR(i.balance)})</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applyAmount">Amount (₹)</Label>
          <Input id="applyAmount" inputMode="decimal" placeholder={suggested} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const res = await applyAdvanceAction({ paymentId, invoiceId, amount: (amount || suggested).replace(/[₹,\s]/g, "") });
              if (res.ok) {
                toast.success(res.message ?? "Done");
                setAmount("");
                router.refresh();
              } else setError(res.error);
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />} Apply
        </Button>
        <div className="sm:col-span-3"><FieldNote error={error} /></div>
      </CardContent>
    </Card>
  );
}
