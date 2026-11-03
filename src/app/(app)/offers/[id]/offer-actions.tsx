"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, CalendarClock, Check, ClipboardCopy, Copy, Download, GitBranch, LayoutTemplate, Loader2, Mail, MoreHorizontal, Pause, Pencil, Play, Send, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { whatsappLink } from "@/components/shared/contact-links";
import { FieldNote } from "@/components/shared/form-fields";
import { canEdit, canRevise, isOpen, type OfferStatus } from "@/lib/offer-status";
import {
  changeOfferStatusAction,
  duplicateOfferAction,
  getShareLinkAction,
  offerToTemplateAction,
  reviseOfferAction,
  sendOfferAction,
  setFollowUpAction,
  setOfferArchivedAction,
} from "@/server/actions/offers";

type Share = { link: string; whatsapp: string; phone: string | null };
type Panel = "send" | "share" | "hold" | "accept" | "reject" | "followup" | "followup-sent" | "template" | null;

export function OfferActions({
  id, status, archived, email, followUp, suggestedFollowUp, today, title, isFirstSend, version,
}: {
  id: string;
  status: OfferStatus;
  archived: boolean;
  email: string;
  followUp: string | null;
  suggestedFollowUp: string;
  today: string;
  title: string;
  isFirstSend: boolean;
  version: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [share, setShare] = useState<Share | null>(null);
  const [to, setTo] = useState(email);
  const [date, setDate] = useState(followUp && followUp >= today ? followUp : suggestedFollowUp);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  const open = (p: Panel, initialText = "") => {
    setError(undefined);
    setText(initialText);
    setPanel(p);
  };

  const finish = (res: { ok: boolean; message?: string; error?: string }, after?: () => void) => {
    if (res.ok) {
      toast.success(res.message ?? "Done");
      setPanel(null);
      after?.();
      router.refresh();
    } else setError(res.error);
  };

  const send = (channel: "email" | "manual") =>
    start(async () => {
      setError(undefined);
      const res = await sendOfferAction({ offerId: id, channel, to: channel === "email" ? to : "", followUpDate: date, changeNote: text });
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
        if (channel === "manual") {
          setShare(res);
          setPanel("share");
        } else setPanel(null);
      } else setError(res.fieldErrors?.to ?? res.fieldErrors?.followUpDate ?? res.error);
    });

  const openShare = () =>
    start(async () => {
      const res = await getShareLinkAction(id);
      if (res.ok) {
        setShare(res);
        setPanel("share");
      } else toast.error(res.error);
    });

  const status_ = (to_: "ON_HOLD" | "SENT" | "ACCEPTED" | "REJECTED") =>
    start(async () =>
      finish(
        await changeOfferStatusAction({
          offerId: id,
          to: to_,
          followUpDate: to_ === "ON_HOLD" || to_ === "SENT" ? date : "",
          reason: to_ === "REJECTED" || to_ === "ON_HOLD" ? text : "",
          acceptedByName: to_ === "ACCEPTED" ? text : "",
        }),
      ),
    );

  const pdf = (
    <Button variant="outline" size="sm" asChild>
      <a href={`/api/offers/${id}/pdf`} target="_blank" rel="noopener noreferrer"><Download /> PDF</a>
    </Button>
  );

  if (archived) {
    return (
      <>
        {pdf}
        <ConfirmButton
          label="Restore"
          icon={<ArchiveRestore />}
          title="Restore this offer?"
          description="It comes back to your list. Share it again to create a new client link."
          confirmLabel="Restore"
          action={() => setOfferArchivedAction(id, false)}
        />
      </>
    );
  }

  const followUpField = (
    <div className="space-y-1.5">
      <Label htmlFor="followUp">Follow-up date</Label>
      <Input id="followUp" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
    </div>
  );

  return (
    <>
      {canEdit(status) && <Button size="sm" onClick={() => open("send")}><Send /> Send</Button>}
      {canEdit(status) && <Button variant="outline" size="sm" asChild><Link href={`/offers/${id}/edit`}><Pencil /> Edit</Link></Button>}
      {isOpen(status) && <Button size="sm" onClick={openShare} disabled={pending}><Share2 /> Share</Button>}
      {isOpen(status) && <Button variant="outline" size="sm" onClick={() => open("accept")}><Check /> Mark accepted</Button>}
      {pdf}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOpen(status) && <DropdownMenuItem onSelect={() => open("send")}><Mail /> Email again</DropdownMenuItem>}
          {isOpen(status) && <DropdownMenuItem onSelect={() => open("followup")}><CalendarClock /> Set follow-up date</DropdownMenuItem>}
          {status === "SENT" && <DropdownMenuItem onSelect={() => open("hold")}><Pause /> Put on hold</DropdownMenuItem>}
          {status === "ON_HOLD" && <DropdownMenuItem onSelect={() => open("followup-sent")}><Play /> Back to Sent</DropdownMenuItem>}
          {isOpen(status) && <DropdownMenuItem onSelect={() => open("reject")}><X /> Mark rejected</DropdownMenuItem>}
          {canRevise(status) && (
            <DropdownMenuItem onSelect={() => start(async () => finish(await reviseOfferAction(id), () => router.push(`/offers/${id}/edit`)))}>
              <GitBranch /> New version (v{version + 1})
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => start(async () => { const res = await duplicateOfferAction(id); if (res.ok) { toast.success(res.message ?? "Copied"); router.push(`/offers/${res.id}`); } else toast.error(res.error); })}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open("template", title)}><LayoutTemplate /> Save as template</DropdownMenuItem>
          {status !== "ACCEPTED" && (
            <DropdownMenuItem onSelect={() => start(async () => { const res = await setOfferArchivedAction(id, true); if (res.ok) { toast.success(res.message ?? "Archived"); router.refresh(); } else toast.error(res.error); })}>
              <Archive /> Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={panel === "send"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isFirstSend ? "Send this offer" : "Email the offer again"}</DialogTitle>
            <DialogDescription>The client gets the PDF and a private link to accept online.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sendTo">Email address</Label>
              <Input id="sendTo" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {followUpField}
            {isFirstSend && version > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="changeNote">What changed in this version? (for your records)</Label>
                <Textarea id="changeNote" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            )}
            <FieldNote error={error} />
          </div>
          <DialogFooter className="sm:justify-between">
            {isFirstSend ? <Button variant="outline" onClick={() => send("manual")} disabled={pending}><Share2 /> Share myself (WhatsApp)</Button> : <span />}
            <Button onClick={() => send("email")} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Mail />} Send email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "share"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share this offer</DialogTitle>
            <DialogDescription>Anyone with this link can view and accept the offer, so only send it to your client.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={share?.link ?? ""} aria-label="Client link" onFocus={(e) => e.target.select()} data-testid="client-link" />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (share) void navigator.clipboard.writeText(share.link).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy. Please copy it by hand."));
              }}
            >
              <ClipboardCopy /> Copy link
            </Button>
            {share && (
              <Button asChild>
                <a
                  href={`${share.phone ? whatsappLink(share.phone) : "https://wa.me/"}?text=${encodeURIComponent(share.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Share2 /> Open WhatsApp
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "hold" || panel === "followup-sent"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{panel === "hold" ? "Put this offer on hold" : "Move back to Sent"}</DialogTitle>
            <DialogDescription>You&apos;ll be reminded on the follow-up date.</DialogDescription>
          </DialogHeader>
          {followUpField}
          {panel === "hold" && (
            <div className="space-y-1.5">
              <Label htmlFor="holdNote">Note (optional)</Label>
              <Textarea id="holdNote" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
            <Button onClick={() => status_(panel === "hold" ? "ON_HOLD" : "SENT")} disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "followup"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Set follow-up date</DialogTitle></DialogHeader>
          {followUpField}
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
            <Button onClick={() => start(async () => finish(await setFollowUpAction(id, date)))} disabled={pending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "accept"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as accepted</DialogTitle>
            <DialogDescription>Use this when the client accepted by phone or message. An accepted offer can&apos;t be changed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="acceptedBy">Who accepted it?</Label>
            <Input id="acceptedBy" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
            <Button onClick={() => status_("ACCEPTED")} disabled={pending}>{pending && <Loader2 className="animate-spin" />} Mark accepted</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "reject"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as rejected</DialogTitle>
            <DialogDescription>The client&apos;s link stops working. You can still start a new version later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rejectReason">Reason</Label>
            <Textarea id="rejectReason" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
            <Button onClick={() => status_("REJECTED")} disabled={pending}>{pending && <Loader2 className="animate-spin" />} Mark rejected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "template"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>Keeps the items and terms so you can reuse them. This offer isn&apos;t changed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="templateName">Template name</Label>
            <Input id="templateName" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
            <Button onClick={() => start(async () => finish(await offerToTemplateAction(id, text)))} disabled={pending}>Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
