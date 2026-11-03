"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, FilePlus2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { setClientArchivedAction } from "@/server/actions/clients";

export function ClientActions({ id, archived }: { id: string; archived: boolean }) {
  if (archived) {
    return (
      <ConfirmButton
        label="Restore"
        icon={<ArchiveRestore />}
        title="Restore this client?"
        description="They'll become Active and appear in your lists and dashboard again."
        confirmLabel="Restore"
        action={() => setClientArchivedAction(id, false)}
      />
    );
  }
  return (
    <>
      <Button size="sm" asChild>
        <Link href={`/offers/new?client=${id}`}><FilePlus2 /> New offer</Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/clients/${id}/edit`}><Pencil /> Edit</Link>
      </Button>
      <ConfirmButton
        label="Archive"
        icon={<Archive />}
        title="Archive this client?"
        description="They'll be hidden from your lists and dashboard. Nothing is deleted, and you can restore them any time. Clients with unpaid invoices or running projects can't be archived."
        confirmLabel="Archive"
        action={() => setClientArchivedAction(id, true)}
      />
    </>
  );
}
