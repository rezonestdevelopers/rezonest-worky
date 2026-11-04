import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { monthKeyOf, todayKey } from "@/lib/dates";
import { idParam, param, type SearchParams } from "@/lib/list-params";
import { getContentFormOptions } from "@/server/queries/content";
import { ContentForm } from "../content-form";

export const metadata: Metadata = { title: "Add content" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("work.manage");
  const sp = await searchParams;
  const options = await getContentFormOptions();
  const today = todayKey();
  const month = param(sp, "month");
  // Opening from another month starts on its first day.
  const publishDate = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month !== monthKeyOf(today) ? `${month}-01` : today;
  const client = idParam(sp, "client");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Add content" back={{ href: "/content", label: "Content Calendar" }} />
      <ContentForm
        id={null}
        clients={options.clients}
        projects={options.projects}
        defaults={{ clientId: client && options.clients.some((c) => c.value === client) ? client : "", projectId: "", format: "STATIC_POST", platforms: ["INSTAGRAM"], topic: "", caption: "", publishDate }}
      />
    </div>
  );
}
