import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, daysBetweenKeys, formatDateKey, formatDateTime, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money/format";
import { assetKindLabel, oneYearAfter, renewalMargin, renewalUrgency } from "@/lib/renewals";
import { setAssetArchivedAction } from "@/server/actions/delivery";
import { getAsset } from "@/server/queries/renewals";
import { AssetForm } from "../asset-form";
import { RenewButton } from "./renew-button";

export const metadata: Metadata = { title: "Renewal item" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const a = await getAsset(id);
  if (!a) notFound();
  const archived = !!a.archivedAt;
  const expiry = dateOnlyKey(a.expiryDate);
  const urgency = renewalUrgency(daysBetweenKeys(todayKey(), expiry));
  const margin = renewalMargin(a.costPrice, a.renewalPrice);
  const clients = await db.client.findMany({ where: { OR: [{ archivedAt: null }, { id: a.clientId }] }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
  const history = await db.activityLog.findMany({ where: { entityType: "DomainHostingAsset", entityId: id, action: "renewal.renewed" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, changes: true } });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={a.name}
        back={{ href: "/renewals", label: "Renewals" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={urgency.tone}>{urgency.label}</Badge>
            <span>{assetKindLabel(a.kind)}</span>
            <Link href={`/clients/${a.client.id}?tab=renewals`} className="underline">{a.client.companyName}</Link>
          </span>
        }
        actions={
          archived ? (
            <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this item?" description="Renewal alerts start again." confirmLabel="Restore" action={setAssetArchivedAction.bind(null, id, false)} />
          ) : (
            <>
              <RenewButton assetId={id} name={a.name} current={formatDateKey(expiry)} suggested={oneYearAfter(expiry)} />
              <ConfirmButton label="Archive" icon={<Archive />} title="Archive this item?" description="Use this when the client no longer needs it. Renewal alerts stop, and nothing is deleted." confirmLabel="Archive" action={setAssetArchivedAction.bind(null, id, true)} />
            </>
          )
        }
      />
      {archived && <div role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">Archived on {formatDateTime(a.archivedAt)}.</div>}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <div className="font-medium tabular-nums" data-testid="asset-margin">
              Margin {formatINR(margin.amount)}{margin.percent !== null && ` (${margin.percent}%)`}
            </div>
            <div className="text-xs text-muted-foreground">Our cost {formatINR(a.costPrice)}, renewal price {formatINR(a.renewalPrice)}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" disabled><Receipt /> Create renewal invoice</Button>
            <span className="text-xs text-muted-foreground">Arrives with invoices in Phase 7.</span>
          </div>
        </CardContent>
      </Card>
      {archived ? null : (
        <AssetForm
          id={id}
          clients={clients.map((c) => ({ value: c.id, label: c.companyName }))}
          defaults={{
            clientId: a.clientId, kind: a.kind, name: a.name, provider: a.provider ?? "", plan: a.plan ?? "", purchaseDate: a.purchaseDate ? dateOnlyKey(a.purchaseDate) : "", expiryDate: expiry,
            emailAccounts: a.emailAccounts?.toString() ?? "", costPrice: a.costPrice.toString(), renewalPrice: a.renewalPrice.toString(), autoRenew: a.autoRenew, credentialsLocation: a.credentialsLocation ?? "", notes: a.notes ?? "",
          }}
        />
      )}
      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Renewal history</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {history.map((h) => {
                const e = (h.changes as { expiry?: { from: string; to: string } } | null)?.expiry;
                return <li key={h.id}>{formatDateTime(h.createdAt)}{e && `: ${formatDateKey(e.from)} → ${formatDateKey(e.to)}`}</li>;
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
