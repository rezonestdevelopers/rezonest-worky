import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommunicationPanel } from "@/components/shared/communication-panel";
import { ContactLinks } from "@/components/shared/contact-links";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey, formatDateTime, istDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money/format";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import { getLeadDetail } from "@/server/queries/leads";
import { LeadActions } from "../lead-actions";

export const metadata: Metadata = { title: "Lead" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || "—"}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  const lead = await getLeadDetail(id);
  if (!lead) notFound();

  const services = lead.servicesInterested.length
    ? await db.service.findMany({ where: { id: { in: lead.servicesInterested } }, select: { id: true, name: true } })
    : [];
  const followUp = lead.nextFollowUpDate ? dateOnlyKey(lead.nextFollowUpDate) : null;
  const open = lead.stage !== "WON" && lead.stage !== "LOST";
  const today = todayKey();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={lead.companyName ?? lead.contactName}
        back={{ href: "/leads", label: "Leads" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="lead" value={lead.stage} />
            {lead.companyName && <span>{lead.contactName}</span>}
            {lead.city && <span>· {lead.city}</span>}
          </span>
        }
        actions={<LeadActions id={lead.id} stage={lead.stage} converted={!!lead.convertedClientId} archived={!!lead.archivedAt} />}
      />

      {lead.archivedAt && (
        <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
          <Archive className="size-4 text-muted-foreground" /> This lead was archived on {formatDateTime(lead.archivedAt)}. Restore it to make changes.
        </div>
      )}
      {lead.convertedClient && (
        <div role="status" className="rounded-lg border border-tone-green/30 bg-tone-green/10 px-3 py-2 text-sm">
          Converted to client{" "}
          <Link href={`/clients/${lead.convertedClient.id}`} className="font-medium underline">{lead.convertedClient.companyName}</Link>
          {lead.convertedAt && ` on ${formatDateTime(lead.convertedAt)}`}.
        </div>
      )}
      {lead.stage === "LOST" && lead.lostReason && (
        <div role="status" className="rounded-lg border border-tone-red/30 bg-tone-red/10 px-3 py-2 text-sm">Lost: {lead.lostReason}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <ContactLinks phone={lead.phone} whatsapp={lead.whatsapp} email={lead.email} />
              <dl className="divide-y">
                <Row label="Contact">{lead.contactName}</Row>
                <Row label="Phone">{lead.phone}</Row>
                <Row label="WhatsApp">{lead.whatsapp}</Row>
                <Row label="Email">{lead.email}</Row>
                <Row label="Sector">{lead.sector?.name}</Row>
                <Row label="Lead source">{lead.leadSource?.name}</Row>
                <Row label="Budget">{lead.approxBudget ? formatINR(lead.approxBudget, { decimals: false }) : null}</Row>
                <Row label="Owner">{lead.owner?.name}</Row>
                <Row label="Next follow-up">
                  {followUp && <span className={cn(open && followUp <= today && "font-medium text-tone-red")}>{formatDateKey(followUp)}</span>}
                </Row>
                <Row label="Services">
                  {services.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {services.map((s) => <span key={s.id} className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.name}</span>)}
                    </span>
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Requirement notes</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{lead.requirementNotes || <span className="text-muted-foreground">No notes yet.</span>}</p>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {lead.stageHistory.map((h) => (
                  <li key={h.id} className="text-sm">
                    <div className="font-medium">
                      {h.fromStage ? `${statusDef("lead", h.fromStage).label} → ` : ""}{statusDef("lead", h.toStage).label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(h.createdAt)}{h.changedBy ? ` · ${h.changedBy.name}` : ""}
                    </div>
                    {h.note && <div className="mt-0.5 text-xs text-muted-foreground">{h.note}</div>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <CommunicationPanel
            leadId={lead.id}
            today={todayKey()}
            rows={lead.communications.map((c) => ({ id: c.id, type: c.type, date: istDateKey(c.date), summary: c.summary, nextAction: c.nextAction, nextActionDate: c.nextActionDate ? dateOnlyKey(c.nextActionDate) : null }))}
          />
          <Card>
            <CardHeader><CardTitle>Offers</CardTitle></CardHeader>
            <CardContent>
              {lead.offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No offers yet.</p>
              ) : (
                <ul className="divide-y">
                  {lead.offers.map((o) => (
                    <li key={o.id} className="py-2 text-sm">
                      <Link href={`/offers/${o.id}`} className="block truncate font-medium hover:underline">{o.title}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge kind="offer" value={o.status} /> {o.number} · {formatDateKey(o.offerDate)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
