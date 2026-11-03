"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DuplicateMatch } from "@/lib/contact-match";

/** Warns that a record may already exist and lets the user decide. */
export function DuplicateDialog({
  matches,
  onCancel,
  onConfirm,
  confirmLabel,
  onLink,
}: {
  matches: DuplicateMatch[] | null;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  /** Offered on each existing client when converting a lead */
  onLink?: (clientId: string) => void;
}) {
  return (
    <Dialog open={!!matches} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>This may already exist</DialogTitle>
          <DialogDescription>We found records with the same details. Please check before creating another one.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {matches?.map((m) => (
            <li key={`${m.kind}-${m.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <Link href={m.kind === "client" ? `/clients/${m.id}` : `/leads/${m.id}`} target="_blank" className="font-medium hover:underline">
                  {m.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {m.kind === "client" ? "Client" : "Lead"} · same {m.reasons.join(", ")}
                </div>
              </div>
              {onLink && m.kind === "client" && (
                <Button size="sm" variant="outline" onClick={() => onLink(m.id)}>Link to this client</Button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Go back</Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
