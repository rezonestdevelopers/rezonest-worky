import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { CheckCircle2, Clock, Download, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfferView } from "@/components/shared/offer-view";
import { dateOnlyKey, formatDateTime, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { publicResponseError } from "@/lib/offer-status";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findOfferLink, loadOfferDocument } from "@/server/services/offers";
import { OfferResponse } from "./offer-response";

export const metadata: Metadata = { title: "Your quotation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-bg min-h-dvh px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <Image src="/logo.png" alt="Rezonest" width={150} height={41} className="h-9 w-auto" priority />
        {children}
      </div>
    </main>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <div className="glass rounded-2xl border p-8 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </Shell>
  );
}

/** The client's page. No login: it shows this one offer and nothing else from the system. */
export default async function PublicOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`offer-view:${clientIp(await headers())}`, 120, 15 * 60_000).ok) {
    return <Message title="Too many requests" text="Please wait a few minutes and try again." />;
  }
  const link = await findOfferLink(db, token);
  const loaded = link && !link.revokedAt ? await loadOfferDocument(db, link.offerId!) : null;
  if (!link || !loaded || loaded.offer.archivedAt) {
    return <Message title="This link is not valid" text="It may have been replaced by a newer version of the offer. Please ask us for the latest link." />;
  }
  const { offer, doc } = loaded;
  await db.publicLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });

  const problem = publicResponseError({
    status: offer.status, todayKey: todayKey(), validUntilKey: dateOnlyKey(offer.validUntil), revoked: false, linkExpired: link.expiresAt < new Date(),
  });
  const contact = [doc.agency.phone, doc.agency.email].filter(Boolean).join(" · ");

  return (
    <Shell>
      {offer.status === "ACCEPTED" && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-tone-green/30 bg-tone-green/10 px-3 py-2 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tone-green" />
          <span>Accepted by {offer.acceptedByName} on {formatDateTime(offer.acceptedAt)}. Thank you! We&apos;ll be in touch shortly.</span>
        </div>
      )}
      {offer.status === "ON_HOLD" && !problem && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-tone-amber/30 bg-tone-amber/10 px-3 py-2 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <span>We&apos;re reviewing this offer. You can still accept it, or send us another message below.</span>
        </div>
      )}
      {problem && offer.status !== "ACCEPTED" && (
        <div role="status" className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{problem}</span>
        </div>
      )}
      <div className="glass rounded-2xl border p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Quotation from {doc.agency.name}</h1>
          <Button variant="outline" size="sm" asChild>
            <a href={`/p/offer/${token}/pdf`}><Download /> Download PDF</a>
          </Button>
        </div>
        <OfferView doc={doc} />
      </div>
      {!problem && <OfferResponse token={token} total={doc.grandTotal} />}
      {contact && <p className="pb-6 text-center text-xs text-muted-foreground">Questions? {doc.agency.name} · {contact}</p>}
    </Shell>
  );
}
