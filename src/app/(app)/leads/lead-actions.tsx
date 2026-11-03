"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, FilePlus2, Loader2, Pencil, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { LEAD_STAGES, type LeadStage } from "@/lib/lead-stage";
import { statusDef } from "@/lib/status";
import { changeLeadStageAction, setLeadArchivedAction } from "@/server/actions/leads";

export function LeadActions({
  id, stage, converted, archived,
}: {
  id: string;
  stage: LeadStage;
  converted: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState("");

  const change = (next: LeadStage, lostReason?: string) =>
    start(async () => {
      const res = await changeLeadStageAction({ leadId: id, stage: next, lostReason });
      if (res.ok) {
        toast.success(res.message ?? "Updated");
        setLostOpen(false);
        setReason("");
        router.refresh();
      } else toast.error(res.fieldErrors?.lostReason ?? res.error);
    });

  if (archived) {
    return (
      <ConfirmButton
        label="Restore"
        icon={<ArchiveRestore />}
        title="Restore this lead?"
        description="It will appear in your leads list and alerts again."
        confirmLabel="Restore"
        action={() => setLeadArchivedAction(id, false)}
      />
    );
  }

  return (
    <>
      {!converted && (
        <Select
          value={stage}
          onValueChange={(v) => {
            const next = v as LeadStage;
            if (next === "WON") router.push(`/leads/${id}/convert`);
            else if (next === "LOST") setLostOpen(true);
            else change(next);
          }}
          disabled={pending}
        >
          <SelectTrigger size="sm" aria-label="Change stage"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LEAD_STAGES.map((s) => <SelectItem key={s} value={s}>{statusDef("lead", s).label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {!converted && (
        <Button size="sm" asChild>
          <Link href={`/leads/${id}/convert`}><UserCheck /> Convert to client</Link>
        </Button>
      )}
      {!converted && (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/offers/new?lead=${id}`}><FilePlus2 /> New offer</Link>
        </Button>
      )}
      <Button variant="outline" size="sm" asChild>
        <Link href={`/leads/${id}/edit`}><Pencil /> Edit</Link>
      </Button>
      <ConfirmButton
        label="Archive"
        icon={<Archive />}
        title="Archive this lead?"
        description="It will be hidden from your list and alerts. Nothing is deleted, and you can restore it any time."
        confirmLabel="Archive"
        action={() => setLeadArchivedAction(id, true)}
      />

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark this lead as lost</DialogTitle>
            <DialogDescription>Why did it not work out? This helps you spot patterns later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lostReason">Reason</Label>
            <Textarea id="lostReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget too low, went with a freelancer" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>Cancel</Button>
            <Button onClick={() => change("LOST", reason)} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Mark as lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
