import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { MasterList } from "./master-list";
import { OnboardingEditor } from "../services/onboarding-editor";

export const metadata: Metadata = { title: "Sectors, sources & departments" };

export default async function ListsPage() {
  await requirePermission("settings.manage");
  const select = { id: true, name: true, isActive: true };
  const [sectors, sources, departments, general] = await Promise.all([
    db.sector.findMany({ orderBy: { sortOrder: "asc" }, select }),
    db.leadSource.findMany({ orderBy: { sortOrder: "asc" }, select }),
    db.department.findMany({ orderBy: { sortOrder: "asc" }, select }),
    db.onboardingTemplateItem.findMany({ where: { serviceId: null, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Sectors, sources & departments" description="The choices shown in forms and filters. Items you switch off stay on old records but can't be picked for new ones." />
      <div className="grid gap-4 lg:grid-cols-3">
        <MasterList kind="sector" title="Sectors" items={sectors} />
        <MasterList kind="leadSource" title="Lead sources" items={sources} />
        <MasterList kind="department" title="Departments" items={departments} />
      </div>
      <OnboardingEditor serviceId={null} title="Onboarding for every client" description="Added to every client's checklist when their offer is accepted. Each service can add its own items in the service catalogue." items={general.map((i) => i.title)} />
    </div>
  );
}
