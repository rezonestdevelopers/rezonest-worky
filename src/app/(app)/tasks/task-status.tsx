"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote } from "@/components/shared/form-fields";
import { statusDef } from "@/lib/status";
import { TASK_STATUSES, type TaskStatus } from "@/lib/work-plan";
import { changeTaskStatusAction } from "@/server/actions/work";

/** Changes a task's status from anywhere. Blocked asks why. Drag-and-drop on the board uses this too. */
export function useTaskStatus(onChanged?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [blocking, setBlocking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  const change = (taskId: string, status: TaskStatus, blockedReason?: string) => {
    if (status === "BLOCKED" && !blockedReason) {
      setReason("");
      setError(undefined);
      setBlocking(taskId);
      return;
    }
    start(async () => {
      const res = await changeTaskStatusAction({ taskId, status, blockedReason });
      if (res.ok) {
        setBlocking(null);
        toast.success(res.message ?? "Updated");
        onChanged?.();
        router.refresh();
      } else if (status === "BLOCKED") setError(res.fieldErrors?.blockedReason ?? res.error);
      else toast.error(res.error);
    });
  };

  const dialog = (
    <Dialog open={!!blocking} onOpenChange={(o) => !o && setBlocking(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What&apos;s blocking this task?</DialogTitle>
          <DialogDescription>The project manager will see this.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="blockedReason">Reason</Label>
          <Textarea id="blockedReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waiting for product photos from the client" />
          <FieldNote error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBlocking(null)}>Cancel</Button>
          <Button onClick={() => blocking && (reason.trim().length >= 3 ? change(blocking, "BLOCKED", reason) : setError("Please say what's blocking this task."))} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Mark blocked
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { change, dialog, pending };
}

export function TaskStatusSelect({ taskId, status, size = "default", onChanged }: { taskId: string; status: TaskStatus; size?: "default" | "sm"; onChanged?: () => void }) {
  const { change, dialog, pending } = useTaskStatus(onChanged);
  return (
    <>
      <Select value={status} onValueChange={(v) => change(taskId, v as TaskStatus)} disabled={pending}>
        <SelectTrigger size={size} className="w-full" aria-label="Task status"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusDef("task", s).label}</SelectItem>)}
        </SelectContent>
      </Select>
      {dialog}
    </>
  );
}
