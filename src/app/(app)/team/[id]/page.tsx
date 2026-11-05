import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { EmployeeForm } from "../employee-form";
import { EmployeeActions } from "./employee-actions";

export const metadata: Metadata = { title: "Team member" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("team.manage");
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id }, include: { employee: true } });
  if (!user) notFound();
  const [departments, others, openTasks] = await Promise.all([
    db.department.findMany({ where: { OR: [{ isActive: true }, ...(user.employee?.departmentId ? [{ id: user.employee.departmentId }] : [])] }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true, id: { not: id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.task.count({ where: { assigneeId: id, archivedAt: null, status: { not: "DONE" } } }),
  ]);
  const e = user.employee;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={user.name}
        description={user.isActive ? user.email : `${user.email} · Inactive`}
        back={{ href: "/team", label: "Team" }}
        actions={<EmployeeActions id={id} name={user.name} active={user.isActive} isSelf={id === me.id} openTasks={openTasks} others={others.map((o) => ({ value: o.id, label: o.name }))} />}
      />
      <EmployeeForm
        id={id}
        departments={departments.map((d) => ({ value: d.id, label: d.name }))}
        defaults={{
          name: user.name, email: user.email, role: user.role, phone: e?.phone ?? "", departmentId: e?.departmentId ?? "", designation: e?.designation ?? "",
          joiningDate: e?.joiningDate ? dateOnlyKey(e.joiningDate) : "", hourlyCost: e?.hourlyCost?.toString() ?? "", dailyDigest: e?.dailyDigest ?? false, emailOnTask: e?.emailOnTask ?? false,
        }}
      />
    </div>
  );
}
