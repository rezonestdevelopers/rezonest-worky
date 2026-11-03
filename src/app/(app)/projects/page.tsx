import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";
import { ListToolbar } from "@/components/data-table/list-toolbar";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import type { SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";
import { statusDef } from "@/lib/status";
import { getProjectList } from "@/server/queries/projects";
import { runDailyWorkIfStale } from "@/server/services/projects";
import { loadViewer, type Viewer } from "@/server/services/tasks";
import { ProjectsTable } from "./projects-table";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("work.own");
  const sp = await searchParams;
  const viewer = await loadViewer(db, user);
  const canManage = can(user.role, "work.manage");
  return (
    <div className="space-y-4">
      <PageHeader title="Projects" description={canManage ? "Everything running for your clients. New projects start from an accepted offer." : "Projects you and your department are working on."} />
      <Suspense fallback={<ListSkeleton />}>
        <ProjectsList sp={sp} viewer={viewer} canManage={canManage} />
      </Suspense>
    </div>
  );
}

async function ProjectsList({ sp, viewer, canManage }: { sp: SearchParams; viewer: Viewer; canManage: boolean }) {
  if (canManage) after(() => runDailyWorkIfStale(db));
  const list = await getProjectList(sp, viewer);
  const filtered = ["q", "status", "health", "type", "view"].some((k) => sp[k]);
  return (
    <div className="space-y-4">
      <ListToolbar
        placeholder="Search project, code, client…"
        exportHref="/api/export/projects"
        filters={[
          { key: "status", label: "Status", options: ["NOT_STARTED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map((s) => ({ value: s, label: statusDef("project", s).label })) },
          { key: "health", label: "Health", options: ["ON_TRACK", "AT_RISK", "DELAYED"].map((s) => ({ value: s, label: statusDef("health", s).label })) },
          { key: "type", label: "Type", options: [{ value: "retainer", label: "Retainer" }, { value: "project", label: "One-off project" }] },
          { key: "view", label: "Showing", options: [{ value: "archived", label: "Archived" }] },
        ]}
      />
      <ProjectsTable rows={list.rows} total={list.total} page={list.page} pageSize={list.pageSize} sort={list.sort} dir={list.dir} today={todayKey()} filtered={filtered} />
    </div>
  );
}
