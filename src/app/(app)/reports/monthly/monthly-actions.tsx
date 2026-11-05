"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import { emailMonthlyReportAction, saveReportNoteAction } from "@/server/actions/reports";

export function ReportNoteForm({ clientId, month, highlights: h, nextPlan: n }: { clientId: string; month: string; highlights: string; nextPlan: string }) {
  const router = useRouter();
  const [highlights, setHighlights] = useState(h);
  const [nextPlan, setNextPlan] = useState(n);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(undefined);
      const res = await saveReportNoteAction({ clientId, month, highlights, nextPlan });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.refresh();
      } else setError(res.error);
    });
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Your words for this month. The rest of the report fills in by itself.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="highlights">Highlights</Label>
            <Textarea id="highlights" rows={4} value={highlights} onChange={(e) => setHighlights(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nextPlan">Plan for next month</Label>
            <Textarea id="nextPlan" rows={4} value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} />
          </div>
        </div>
        <FieldNote error={error} />
        <div className="flex justify-end">
          <Button variant="outline" disabled={pending} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save words</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmailReportButton({ clientId, month, defaultTo }: { clientId: string; month: string; defaultTo: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" onClick={() => { setError(undefined); setOpen(true); }}><Mail /> Email to client</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Email this report</DialogTitle>
            <DialogDescription>The PDF goes along with it. You can change the words in Settings → Email templates.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reportTo">Send to</Label>
            <Input id="reportTo" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const res = await emailMonthlyReportAction({ clientId, month, to });
                  if (res.ok) {
                    toast.success(res.message ?? "Sent");
                    setOpen(false);
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
