import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work.manage");
  const { id } = await params;
  const p = await db.project.findUnique({ where: { id } });
  if (!p) notFound();
  if (p.archivedAt) redirect(`/projects/${id}`);
  const users = await db.user.findMany({ where: { OR: [{ isActive: true }, ...(p.managerId ? [{ id: p.managerId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Edit ${p.code}`} back={{ href: `/projects/${id}`, label: "Back to project" }} />
      <ProjectForm
        id={id}
        isRetainer={p.isRetainer}
        autoHealth={p.healthAuto}
        people={users.map((u) => ({ value: u.id, label: u.name }))}
        defaults={{
          name: p.name, managerId: p.managerId ?? "", status: p.status, startDate: dateOnlyKey(p.startDate), deadline: p.deadline ? dateOnlyKey(p.deadline) : "",
          retainerEnd: p.retainerEnd ? dateOnlyKey(p.retainerEnd) : "", autoRenew: p.autoRenew, healthOverride: p.healthOverride ?? "", healthOverrideNote: p.healthOverrideNote ?? "", notes: p.notes ?? "",
        }}
      />
    </div>
  );
}
