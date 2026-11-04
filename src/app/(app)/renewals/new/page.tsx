import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { idParam, type SearchParams } from "@/lib/list-params";
import { AssetForm } from "../asset-form";

export const metadata: Metadata = { title: "Add renewal item" };

export default async function NewAssetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const client = idParam(await searchParams, "client");
  const clients = await db.client.findMany({ where: { archivedAt: null }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Add domain, hosting, SSL or email" back={{ href: "/renewals", label: "Renewals" }} />
      <AssetForm
        id={null}
        clients={clients.map((c) => ({ value: c.id, label: c.companyName }))}
        defaults={{ clientId: client && clients.some((c) => c.id === client) ? client : "", kind: "DOMAIN", name: "", provider: "", plan: "", purchaseDate: "", expiryDate: "", emailAccounts: "", costPrice: "", renewalPrice: "", autoRenew: false, credentialsLocation: "", notes: "" }}
      />
    </div>
  );
}
