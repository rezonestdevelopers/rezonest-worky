"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, FileDown, Loader2, RotateCcw, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import type { ActionResult } from "@/lib/action-result";
import { DESIGN_STATUSES } from "@/lib/content-plan";
import { statusDef } from "@/lib/status";
import {
  approveByHandAction,
  markPublishedAction,
  reopenForApprovalAction,
  setCreativeLinkAction,
  setDesignStatusAction,
  undoPublishedAction,
  uploadCreativeAction,
} from "@/server/actions/delivery";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        after?.();
        router.refresh();
      } else setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error);
    });
  return { pending, run, error };
}

export function DesignPanel({ itemId, status, readOnly }: { itemId: string; status: string; readOnly: boolean }) {
  const { pending, run, error } = useAct();
  return (
    <Card>
      <CardContent className="space-y-1.5">
        <Label htmlFor="designStatus">Design status</Label>
        <Select value={status} disabled={pending || readOnly} onValueChange={(v) => run(() => setDesignStatusAction({ itemId, designStatus: v as (typeof DESIGN_STATUSES)[number] }))}>
          <SelectTrigger id="designStatus" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DESIGN_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusDef("design", s).label}</SelectItem>)}
          </SelectContent>
        </Select>
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}

export function CreativePanel({ itemId, readOnly, url, openUrl, image, file }: { itemId: string; readOnly: boolean; url: string; openUrl: string | null; image: string | null; file: { href: string; name: string } | null }) {
  const { pending, run, error } = useAct();
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(url);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Creative</CardTitle>
        {!readOnly && (
          <>
            <input
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
              aria-label="Creative file"
              data-testid="creative-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.set("itemId", itemId);
                fd.set("file", f);
                run(() => uploadCreativeAction(fd), () => {
                  if (input.current) input.current.value = "";
                });
              }}
            />
            <Button variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="animate-spin" /> : <Upload />} Upload</Button>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {image && (
          // A private file behind a permission check, so the image optimiser isn't used.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="Creative" className="max-h-96 w-auto max-w-full rounded-lg border" />
        )}
        {file && <Button variant="outline" size="sm" asChild><a href={file.href}><FileDown /> {file.name}</a></Button>}
        {openUrl && <Button variant="outline" size="sm" asChild><a href={openUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open the link</a></Button>}
        {!image && !file && !openUrl && <p className="text-sm text-muted-foreground">Nothing yet. Upload an image or PDF up to 5 MB. For reels and videos, paste a Drive or YouTube link.</p>}
        {!readOnly && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setCreativeLinkAction({ itemId, creativeUrl: link }));
            }}
          >
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" aria-label="Link to the creative" inputMode="url" className="h-8" />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>Save link</Button>
          </form>
        )}
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}

export function ApprovalPanel({ itemId, status }: { itemId: string; status: string }) {
  const { pending, run, error } = useAct();
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>Approval</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status === "CHANGES_REQUESTED" && (
          <div className="space-y-2">
            <p className="text-muted-foreground">Once you&apos;ve made the changes, send it back so the client can look again.</p>
            <Button size="sm" disabled={pending} onClick={() => run(() => reopenForApprovalAction(itemId))}><Send /> Ready for the client again</Button>
          </div>
        )}
        {status === "APPROVED" ? (
          <p className="text-muted-foreground">The client has approved this. If the words or creative change, it goes back to them.</p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="handApproval">Approved on a call or WhatsApp?</Label>
            <Textarea id="handApproval" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asha approved on WhatsApp on 4 Nov" />
            <Button variant="outline" size="sm" disabled={pending || !note.trim()} onClick={() => run(() => approveByHandAction({ itemId, comment: note }), () => setNote(""))}><Check /> Record as approved</Button>
          </div>
        )}
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}

export function PublishPanel({ itemId, canUndo, published, approved }: { itemId: string; canUndo: boolean; published: { at: string; link: string | null } | null; approved: boolean }) {
  const { pending, run, error } = useAct();
  const [link, setLink] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>Publishing</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {published ? (
          <>
            <p>Published on {published.at}.</p>
            <div className="flex flex-wrap gap-2">
              {published.link && <Button variant="outline" size="sm" asChild><a href={published.link} target="_blank" rel="noopener noreferrer"><ExternalLink /> See it live</a></Button>}
              {canUndo && <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => undoPublishedAction(itemId))}><RotateCcw /> Undo</Button>}
            </div>
          </>
        ) : approved ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => markPublishedAction({ itemId, publishedLink: link }));
            }}
          >
            <Label htmlFor="publishedLink">Link to the live post</Label>
            <Input id="publishedLink" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="https://www.instagram.com/p/…" />
            <Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Mark as published</Button>
          </form>
        ) : (
          <p className="text-muted-foreground">This can be marked as published once the client has approved it.</p>
        )}
        <FieldNote error={error} />
      </CardContent>
    </Card>
  );
}
