"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import type { ActionResult } from "@/lib/action-result";
import { createDraftFromAction } from "@/server/actions/invoices";

type Source = { kind: "project" | "milestone" | "renewal"; id: string } | { kind: "retainer"; id: string; month: string } | { kind: "changes"; id: string; ids: string[] };

/** Makes a draft from existing work and opens it for review. Nothing is sent. */
export function OpenDraftButton({ label, variant = "outline", ...source }: Source & { label: string; variant?: "outline" | "ghost" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createDraftFromAction(source as Parameters<typeof createDraftFromAction>[0]);
          if (res.ok) router.push(`/invoices/${res.id}`);
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Receipt />} {label}
    </Button>
  );
}

/** A button that asks for a reason in a box, then runs the action. For cancelling and voiding. */
export function ReasonButton({ label, icon, title, description, confirmLabel, action, redirectTo }: { label: string; icon?: React.ReactNode; title: string; description: string; confirmLabel: string; action: (reason: string) => Promise<ActionResult>; redirectTo?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await action(reason);
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else setError(res.error);
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setError(undefined); setReason(""); setOpen(true); }}>{icon}{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Keep it</Button>
            <Button onClick={run} disabled={pending}>{pending && <Loader2 className="animate-spin" />} {confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Asks which date a proforma's tax invoice should carry, then creates it. */
export function DateActionButton({ label, icon, title, description, confirmLabel, defaultDate, max, action }: { label: string; icon?: React.ReactNode; title: string; description: string; confirmLabel: string; defaultDate: string; max?: string; action: (date: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await action(date);
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setOpen(false);
        router.push(`/invoices/${res.id}`);
      } else setError(res.error);
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setError(undefined); setOpen(true); }}>{icon}{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="actionDate">Tax invoice date</Label>
            <Input id="actionDate" type="date" value={date} max={max} onChange={(e) => setDate(e.target.value)} />
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button onClick={run} disabled={pending}>{pending && <Loader2 className="animate-spin" />} {confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
