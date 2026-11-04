import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { idParam, type SearchParams } from "@/lib/list-params";
import { AdImport } from "./ad-import";

export const metadata: Metadata = { title: "Upload ads report" };

export default async function AdImportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("work.manage");
  const client = idParam(await searchParams, "client");
  const clients = await db.client.findMany({ where: { archivedAt: null, adCampaigns: { some: { archivedAt: null } } }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Upload ads report" description="Export a report from Meta Ads Manager and add its figures to your campaigns here." back={{ href: "/ads", label: "Meta Ads" }} />
      <AdImport clients={clients.map((c) => ({ value: c.id, label: c.companyName }))} defaultClient={client && clients.some((c) => c.id === client) ? client : ""} />
    </div>
  );
}
