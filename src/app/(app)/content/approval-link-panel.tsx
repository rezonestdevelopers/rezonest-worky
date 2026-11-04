"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCopy, Link2, Loader2, Mail, Send, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { whatsappLink } from "@/components/shared/contact-links";
import { FieldNote } from "@/components/shared/form-fields";
import { emailContentLinkAction, revokeContentLinkAction, shareContentLinkAction } from "@/server/actions/delivery";

type Share = { link: string; whatsapp: string; phone: string | null };

/** Sends one client's month for approval. The link shows only that client's content for that month. */
export function ApprovalLinkPanel({
  clientId, month, monthLabel, clientName, email, link,
}: {
  clientId: string;
  month: string;
  monthLabel: string;
  clientName: string;
  email: string;
  link: { id: string; views: number; lastViewed: string | null; expires: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [share, setShare] = useState<Share | null>(null);
  const [to, setTo] = useState(email);
  const [error, setError] = useState<string>();

  const open = () =>
    start(async () => {
      const res = await shareContentLinkAction({ clientId, month });
      if (!res.ok) return void toast.error(res.error);
      setError(undefined);
      setTo(res.email ?? email);
      setShare({ link: res.link, whatsapp: res.whatsapp, phone: res.phone });
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">Client approval: {clientName}, {monthLabel}</div>
          <div className="text-xs text-muted-foreground" data-testid="approval-link-state">
            {link ? `Link active until ${link.expires}. Opened ${link.views} time${link.views === 1 ? "" : "s"}${link.lastViewed ? `, last on ${link.lastViewed}` : ""}.` : "No link shared yet. The client won't need to log in."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={open}>{pending ? <Loader2 className="animate-spin" /> : link ? <Link2 /> : <Send />} {link ? "Share link" : "Send for approval"}</Button>
          {link && (
            <ConfirmButton
              label="Withdraw"
              icon={<X />}
              title="Withdraw this link?"
              description="The client won't be able to open it any more. Their answers so far are kept. You can create a new link later."
              confirmLabel="Withdraw link"
              action={revokeContentLinkAction.bind(null, link.id)}
            />
          )}
        </div>
      </CardContent>
      <Dialog open={!!share} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send {monthLabel} for approval</DialogTitle>
            <DialogDescription>Anyone with this link can see and answer on {clientName}&apos;s content for this month, so only send it to your client.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={share?.link ?? ""} aria-label="Client approval link" onFocus={(e) => e.target.select()} data-testid="content-link" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (share) void navigator.clipboard.writeText(share.link).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy. Please copy it by hand."));
              }}
            >
              <ClipboardCopy /> Copy link
            </Button>
            {share && (
              <Button variant="outline" size="sm" asChild>
                <a href={`${share.phone ? whatsappLink(share.phone) : "https://wa.me/"}?text=${encodeURIComponent(share.whatsapp)}`} target="_blank" rel="noopener noreferrer"><Share2 /> Open WhatsApp</a>
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="approvalEmail">Or email it to</Label>
            <Input id="approvalEmail" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShare(null)}>Close</Button>
            <Button
              disabled={pending || !to.trim()}
              onClick={() =>
                start(async () => {
                  const res = await emailContentLinkAction({ clientId, month, to });
                  if (res.ok) {
                    toast.success(res.message ?? "Emailed");
                    setShare(null);
                  } else setError(res.error);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Mail />} Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
