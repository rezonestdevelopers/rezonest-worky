"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action-result";

/** A button that asks "are you sure?" first, then runs the action and shows the result. */
export function ConfirmButton({
  label,
  icon,
  title,
  description,
  confirmLabel,
  action,
  variant = "outline",
  redirectTo,
  ariaLabel,
}: {
  label: string;
  icon?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<ActionResult>;
  variant?: "outline" | "ghost" | "destructive";
  redirectTo?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setOpen(false);
        toast.error(res.error);
      }
    });

  return (
    <>
      <Button variant={variant} size="sm" aria-label={ariaLabel} onClick={() => setOpen(true)}>{icon}{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button onClick={run} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
