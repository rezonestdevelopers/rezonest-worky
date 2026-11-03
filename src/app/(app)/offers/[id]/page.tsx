import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OfferView } from "@/components/shared/offer-view";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { addDaysKey, dateOnlyKey, formatDateKey, formatDateTime, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money/format";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { getOfferHistory } from "@/server/queries/offers";
import { expireOverdueOffers, loadOfferDocument } from "@/server/services/offers";
import { OfferActions } from "./offer-actions";

export const metadata: Metadata = { title: "Offer" };

type Snapshot = { grandTotal?: string; items?: { description: string; quantity: string; unit: string; rate: string }[] };

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  await expireOverdueOffers(db);
  const [loaded, [history, versions, links]] = await Promise.all([loadOfferDocument(db, id), getOfferHistory(id)]);
  if (!loaded || loaded.offer.isTemplate) notFound();
  const { offer, doc } = loaded;

  const today = todayKey();
  const followUp = offer.followUpDate ? dateOnlyKey(offer.followUpDate) : null;
  const views = links.reduce((n, l) => n + l.viewCount, 0);
  const lastViewed = links.map((l) => l.lastViewedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const recipient = offer.client
    ? { href: `/clients/${offer.client.id}?tab=offers`, label: offer.client.companyName, kind: "Client" }
    : offer.lead
      ? { href: `/leads/${offer.lead.id}`, label: offer.lead.companyName ?? offer.lead.contactName, kind: "Lead" }
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={offer.number}
        back={{ href: "/offers", label: "Offers" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="offer" value={offer.status} />
            {offer.currentVersion > 1 && <span>Version {offer.currentVersion}</span>}
            {recipient && <Link href={recipient.href} className="underline">{recipient.label}</Link>}
            {recipient && <span>({recipient.kind.toLowerCase()})</span>}
          </span>
        }
        actions={
          <OfferActions
            id={offer.id}
            status={offer.status}
            archived={!!offer.archivedAt}
            email={doc.recipient.email ?? ""}
            followUp={followUp}
            suggestedFollowUp={addDaysKey(today, 3)}
            today={today}
            title={offer.title}
            isFirstSend={offer.status === "DRAFT"}
            version={offer.currentVersion}
          />
        }
      />

      {offer.archivedAt && (
        <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
          <Archive className="size-4 text-muted-foreground" /> Archived on {formatDateTime(offer.archivedAt)}. The client&apos;s link no longer works.
        </div>
      )}
      {offer.status === "ACCEPTED" && (
        <div role="status" className="space-y-1 rounded-lg border border-tone-green/30 bg-tone-green/10 px-3 py-2 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tone-green" />
            <span>
              Accepted by <strong>{offer.acceptedByName}</strong> on {formatDateTime(offer.acceptedAt)}
              {offer.acceptedIp && ` from IP ${offer.acceptedIp}`} (version {offer.acceptedVersion ?? offer.currentVersion}).
            </span>
          </div>
          <p className="pl-6 text-xs text-muted-foreground">
            “Convert to project” arrives in Phase 4.
            {!offer.clientId && offer.lead && (
              <> This lead isn&apos;t a client yet: <Link href={`/leads/${offer.lead.id}/convert`} className="underline">convert it to a client</Link>.</>
            )}
          </p>
        </div>
      )}
      {offer.status === "REJECTED" && offer.rejectReason && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-tone-red/30 bg-tone-red/10 px-3 py-2 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-tone-red" /> Rejected: {offer.rejectReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="min-w-0">
          <CardContent><OfferView doc={doc} /></CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          {(followUp || links.length > 0) && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                {followUp && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Follow-up</span>
                    <span className={cn("tabular-nums", followUp <= today && "font-medium text-tone-red")}>{formatDateKey(followUp)}</span>
                  </div>
                )}
                {links.length > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Client opened the link</span>
                    <span className="text-right tabular-nums">
                      {views} time{views === 1 ? "" : "s"}
                      {lastViewed && <span className="block text-xs text-muted-foreground">last {formatDateTime(lastViewed)}</span>}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Status history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <div className="font-medium">{h.fromStatus ? `${statusDef("offer", h.fromStatus).label} → ` : ""}{statusDef("offer", h.toStatus).label}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(h.createdAt)} · {h.changedBy?.name ?? (h.changedVia === "public_link" ? "Client, through the link" : "System")}
                    </div>
                    {h.note && <div className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">{h.note}</div>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          {versions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Versions sent</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {versions.map((v) => {
                    const snap = v.snapshot as Snapshot;
                    return (
                      <li key={v.id}>
                        <details>
                          <summary className="cursor-pointer">
                            <span className="font-medium">v{v.version}</span> · {formatDateTime(v.createdAt)}
                            {snap.grandTotal && <span className="tabular-nums"> · {formatINR(snap.grandTotal)}</span>}
                          </summary>
                          <div className="mt-1 space-y-1 pl-4 text-xs text-muted-foreground">
                            {v.changeNote && <p>{v.changeNote}</p>}
                            {snap.items?.map((i, n) => <p key={n}>{i.description}: {i.quantity} {i.unit} × {formatINR(i.rate)}</p>)}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
