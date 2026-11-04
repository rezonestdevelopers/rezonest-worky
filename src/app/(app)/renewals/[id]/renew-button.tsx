"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldNote } from "@/components/shared/form-fields";
import { renewAssetAction } from "@/server/actions/delivery";

export function RenewButton({ assetId, name, current, suggested }: { assetId: string; name: string; current: string; suggested: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(suggested);
  const [error, setError] = useState<string>();

  return (
    <>
      <Button size="sm" onClick={() => { setDate(suggested); setError(undefined); setOpen(true); }}><RefreshCw /> Mark renewed</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as renewed</DialogTitle>
            <DialogDescription>{name} currently expires on {current}. This doesn&apos;t renew it with the provider; do that first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="newExpiry">New expiry date</Label>
            <Input id="newExpiry" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await renewAssetAction({ assetId, newExpiry: date });
                  if (res.ok) {
                    toast.success(res.message ?? "Saved");
                    setOpen(false);
                    router.refresh();
                  } else setError(res.fieldErrors?.newExpiry ?? res.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Save new date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
