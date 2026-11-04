import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getContentFormOptions } from "@/server/queries/content";
import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("work.manage");
  const options = await getContentFormOptions();
  const client = idParam(await searchParams, "client");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="New campaign" back={{ href: "/ads", label: "Meta Ads" }} />
      <CampaignForm
        id={null}
        clients={options.clients}
        projects={options.projects}
        defaults={{ clientId: client && options.clients.some((c) => c.value === client) ? client : "", projectId: "", name: "", objective: "", status: "ACTIVE", startDate: todayKey(), endDate: "", plannedBudget: "" }}
      />
    </div>
  );
}
