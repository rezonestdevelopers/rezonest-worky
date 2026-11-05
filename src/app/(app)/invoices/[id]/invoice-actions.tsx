"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BellRing, Ban, CreditCard, FileMinus, FileText, Loader2, Mail, MessageCircle, Pencil, Stamp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { whatsappLink } from "@/components/shared/contact-links";
import { FieldNote } from "@/components/shared/form-fields";
import { cancelInvoiceAction, convertProformaAction, discardInvoiceAction, issueInvoiceAction, sendInvoiceEmailAction, sendPaymentReminderAction } from "@/server/actions/invoices";
import { DateActionButton, ReasonButton } from "../open-draft-button";

type Level = "polite" | "firm" | "final";
export type ReminderTexts = Record<Level, { subject: string; text: string; whatsapp: string | null }>;

function SendEmailButton({ invoiceId, defaultTo, subject, text }: { invoiceId: string; defaultTo: string; subject: string; text: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setError(undefined); setOpen(true); }}><Mail /> Email</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Email this invoice</DialogTitle>
            <DialogDescription>The PDF goes along with it. You can change these words in Settings → Email templates.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoiceTo">Send to</Label>
              <Input id="invoiceTo" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
              <FieldNote error={error} />
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{subject}</div>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{text}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await sendInvoiceEmailAction({ invoiceId, to });
                  if (res.ok) {
                    toast.success(res.message ?? "Sent");
                    setOpen(false);
                    router.refresh();
                  } else setError(res.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Sends only when you click. Nothing here runs by itself. */
function ReminderButton({ invoiceId, defaultTo, phone, texts }: { invoiceId: string; defaultTo: string; phone: string | null; texts: ReminderTexts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>("polite");
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const t = texts[level];
  const whatsapp = t.whatsapp ? `${phone ? whatsappLink(phone) : "https://wa.me/"}?text=${encodeURIComponent(t.whatsapp)}` : null;
  const send = (channel: "email" | "whatsapp") =>
    start(async () => {
      setError(undefined);
      const res = await sendPaymentReminderAction({ invoiceId, level, channel, ...(channel === "email" ? { to } : {}) });
      if (res.ok) {
        toast.success(res.message ?? "Done");
        if (channel === "email") setOpen(false);
        router.refresh();
      } else setError(res.error);
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setError(undefined); setOpen(true); }}><BellRing /> Payment reminder</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send a payment reminder</DialogTitle>
            <DialogDescription>It goes only when you click below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1.5" role="group" aria-label="Tone">
              {(["polite", "firm", "final"] as const).map((l) => (
                <Button key={l} type="button" size="sm" variant={l === level ? "default" : "outline"} aria-pressed={l === level} onClick={() => setLevel(l)} className="capitalize">{l}</Button>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{t.subject}</div>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{t.text}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminderTo">Email to</Label>
              <Input id="reminderTo" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            {whatsapp && (
              <Button variant="outline" asChild>
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => send("whatsapp")}><MessageCircle /> WhatsApp</a>
              </Button>
            )}
            <Button disabled={pending} onClick={() => send("email")}>{pending ? <Loader2 className="animate-spin" /> : <Mail />} Send email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InvoiceActions(props: {
  id: string;
  clientId: string;
  type: string;
  status: string;
  canConvert: boolean;
  hasCreditRoom: boolean;
  balanceDue: boolean;
  problems: string[];
  today: string;
  email: string;
  phone: string | null;
  mail: { subject: string; text: string; whatsapp: string | null };
  reminders: ReminderTexts;
}) {
  const { id, type, status } = props;
  const whatsapp = props.mail.whatsapp ? `${props.phone ? whatsappLink(props.phone) : "https://wa.me/"}?text=${encodeURIComponent(props.mail.whatsapp)}` : null;
  const issuedTax = type === "TAX" && status === "ISSUED";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noopener noreferrer"><FileText /> PDF</a>
      </Button>
      {status === "DRAFT" && (
        <>
          <Button variant="outline" size="sm" asChild><Link href={`/invoices/${id}/edit`}><Pencil /> Edit</Link></Button>
          <ConfirmButton label="Discard" icon={<Trash2 />} title="Discard this draft?" description="It has no number yet, so no number is lost." confirmLabel="Discard draft" action={() => discardInvoiceAction(id)} redirectTo="/invoices" />
          {props.problems.length === 0 && (
            <ConfirmButton
              variant="outline"
              label="Issue"
              icon={<Stamp />}
              title="Issue this invoice?"
              description="It gets its number and is locked. After this, it can only be corrected with a credit note or cancelled."
              confirmLabel="Issue invoice"
              action={() => issueInvoiceAction(id)}
            />
          )}
        </>
      )}
      {status === "ISSUED" && (
        <>
          <SendEmailButton invoiceId={id} defaultTo={props.email} subject={props.mail.subject} text={props.mail.text} />
          {whatsapp && (
            <Button variant="outline" size="sm" asChild>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a>
            </Button>
          )}
          {issuedTax && props.balanceDue && <Button variant="outline" size="sm" asChild><Link href={`/payments/new?client=${props.clientId}&invoice=${id}`}><CreditCard /> Record payment</Link></Button>}
          {issuedTax && props.balanceDue && <ReminderButton invoiceId={id} defaultTo={props.email} phone={props.phone} texts={props.reminders} />}
          {issuedTax && props.hasCreditRoom && <Button variant="outline" size="sm" asChild><Link href={`/invoices/${id}/credit-note`}><FileMinus /> Credit note</Link></Button>}
          {type === "PROFORMA" && <Button variant="outline" size="sm" asChild><Link href={`/payments/new?client=${props.clientId}`}><CreditCard /> Record advance</Link></Button>}
          {props.canConvert && (
            <DateActionButton
              label="Convert to tax invoice"
              icon={<Stamp />}
              title="Convert to a tax invoice?"
              description="This makes a new tax invoice with its own number, locked once created. The proforma stays on record as Converted."
              confirmLabel="Convert"
              defaultDate={props.today}
              max={props.today}
              action={(date) => convertProformaAction(id, date)}
            />
          )}
          <ReasonButton label="Cancel invoice" icon={<Ban />} title="Cancel this invoice?" description="It stays on record with its number, marked Cancelled. This can't be undone." confirmLabel="Cancel invoice" action={(reason) => cancelInvoiceAction(id, reason)} />
        </>
      )}
    </div>
  );
}

export function IssueProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-tone-amber/40 bg-tone-amber/10 p-3 text-sm" role="alert" data-testid="issue-problems">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-tone-amber" />
      <div>
        <p className="font-medium">This can&apos;t be issued yet</p>
        <ul className="mt-1 list-disc pl-4">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">
          <Link href="/settings" className="underline">Open Settings</Link>, or edit this draft to fix the lines.
        </p>
      </div>
    </div>
  );
}
