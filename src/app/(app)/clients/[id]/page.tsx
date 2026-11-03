import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/dates";
import { param, type SearchParams } from "@/lib/list-params";
import { formatINR } from "@/lib/money/format";
import { can } from "@/lib/permissions";
import { safeExternalUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { getClientHeader, getClientOverview } from "@/server/queries/clients";
import { ClientActions } from "./client-actions";
import { ContactsCard } from "./contacts-card";
import { ClientTab } from "./tabs";

export const metadata: Metadata = { title: "Client" };

const TABS: { key: string; label: string; money?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "offers", label: "Offers" },
  { key: "projects", label: "Projects" },
  { key: "tasks", label: "Tasks" },
  { key: "content", label: "Content Calendar" },
  { key: "ads", label: "Ads" },
  { key: "renewals", label: "Renewals" },
  { key: "invoices", label: "Invoices", money: true },
  { key: "payments", label: "Payments", money: true },
  { key: "expenses", label: "Expenses", money: true },
  { key: "documents", label: "Documents" },
  { key: "communication", label: "Communication Log" },
  { key: "reports", label: "Reports" },
  { key: "activity", label: "Activity" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || "—"}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function ClientDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("sales.manage");
  const { id } = await params;
  const showMoney = can(user.role, "finance.manage");
  const client = await getClientHeader(id);
  if (!client) notFound();

  const tabs = TABS.filter((t) => showMoney || !t.money);
  const requested = param(await searchParams, "tab");
  const tab = tabs.find((t) => t.key === requested)?.key ?? "overview";
  const website = safeExternalUrl(client.website);
  const archived = !!client.archivedAt;

  return (
    <div className="space-y-4">
      <PageHeader
        title={client.companyName}
        back={{ href: "/clients", label: "Clients" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="client" value={client.status} />
            {client.sector && <span>{client.sector.name}</span>}
            {client.city && <span>· {client.city}</span>}
          </span>
        }
        actions={<ClientActions id={client.id} archived={archived} />}
      />

      {archived && (
        <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
          <Archive className="size-4 text-muted-foreground" /> This client was archived on {formatDateTime(client.archivedAt)}. Restore them to make changes.
        </div>
      )}

      <nav aria-label="Client sections" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/clients/${id}?tab=${t.key}`}
            scroll={false}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              t.key === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Suspense key={tab} fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
        {tab === "overview" ? (
          <Overview
            clientId={id}
            showMoney={showMoney}
            archived={archived}
            contacts={client.contacts}
            website={website}
            details={client}
          />
        ) : (
          <ClientTab tab={tab} clientId={id} />
        )}
      </Suspense>
    </div>
  );
}

async function Overview({
  clientId, showMoney, archived, contacts, website, details,
}: {
  clientId: string;
  showMoney: boolean;
  archived: boolean;
  contacts: NonNullable<Awaited<ReturnType<typeof getClientHeader>>>["contacts"];
  website: string | null;
  details: NonNullable<Awaited<ReturnType<typeof getClientHeader>>>;
}) {
  const o = await getClientOverview(clientId, showMoney);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Active projects" value={o.activeProjects} />
        <Stat label="Open tasks" value={o.openTasks} />
        <Stat label="Offers awaiting reply" value={o.openOffers} />
        {showMoney && <Stat label="Invoiced (excl. GST)" value={formatINR(o.invoicedExclGst ?? 0, { decimals: false })} />}
        {showMoney && <Stat label="Outstanding" value={formatINR(o.outstanding ?? 0, { decimals: false })} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Phone">{details.phone}</Row>
              <Row label="WhatsApp">{details.whatsapp}</Row>
              <Row label="Email">{details.email}</Row>
              <Row label="Website">
                {website ? <a href={website} target="_blank" rel="noopener noreferrer" className="underline">{details.website}</a> : details.website}
              </Row>
              <Row label="State (for GST)">{details.country === "India" ? `${details.state} (${details.stateCode})` : `${details.country}, outside India`}</Row>
              <Row label="Billing address">{[details.billingAddress, details.city, details.pincode].filter(Boolean).join(", ")}</Row>
              <Row label="GSTIN">{details.gstin}</Row>
              <Row label="PAN">{details.pan}</Row>
              <Row label="Lead source">{details.leadSource?.name}</Row>
              <Row label="Account manager">{details.accountManager?.name}</Row>
              <Row label="Tags">
                {details.tags.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {details.tags.map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}
                  </span>
                )}
              </Row>
              {details.leads.length > 0 && (
                <Row label="Came from lead">
                  <span className="flex flex-wrap gap-2">
                    {details.leads.map((l) => <Link key={l.id} href={`/leads/${l.id}`} className="underline">{l.contactName}</Link>)}
                  </span>
                </Row>
              )}
            </dl>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <ContactsCard
            clientId={clientId}
            readOnly={archived}
            contacts={contacts.map((c) => ({ id: c.id, name: c.name, designation: c.designation, phone: c.phone, whatsapp: c.whatsapp, email: c.email, isPrimary: c.isPrimary }))}
          />
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{details.notes || <span className="text-muted-foreground">No notes yet.</span>}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
