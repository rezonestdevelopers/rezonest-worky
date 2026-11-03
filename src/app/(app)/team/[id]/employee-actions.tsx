"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FieldNote } from "@/components/shared/form-fields";
import { deactivateEmployeeAction, reactivateEmployeeAction, sendPasswordLinkAction } from "@/server/actions/work";

const QUEUE = "__queue";

export function EmployeeActions({ id, name, active, isSelf, openTasks, others }: { id: string; name: string; active: boolean; isSelf: boolean; openTasks: number; others: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(QUEUE);
  const [error, setError] = useState<string>();

  if (!active) {
    return <ConfirmButton label="Reactivate" icon={<UserCheck />} title={`Reactivate ${name}?`} description="They'll be able to sign in again." confirmLabel="Reactivate" action={reactivateEmployeeAction.bind(null, id)} />;
  }
  return (
    <>
      <ConfirmButton label="Send password link" icon={<KeyRound />} title="Email a password link?" description={`${name} gets a link to choose a new password. It works once, for 3 days.`} confirmLabel="Send link" action={sendPasswordLinkAction.bind(null, id)} />
      {!isSelf && <Button variant="outline" size="sm" onClick={() => { setError(undefined); setOpen(true); }}><UserX /> Deactivate</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate {name}?</DialogTitle>
            <DialogDescription>They won&apos;t be able to sign in. Their history stays. {openTasks ? `They have ${openTasks} open task${openTasks === 1 ? "" : "s"}.` : "They have no open tasks."}</DialogDescription>
          </DialogHeader>
          {openTasks > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="reassign">Hand their open tasks to</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="reassign" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUEUE}>Nobody (back to the department)</SelectItem>
                  {others.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deactivateEmployeeAction(id, to === QUEUE ? null : to);
                  if (res.ok) {
                    toast.success(res.message ?? "Done");
                    setOpen(false);
                    router.refresh();
                  } else setError(res.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
