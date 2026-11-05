import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Add person" };

export default async function NewEmployeePage() {
  await requirePermission("team.manage");
  const departments = await db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Add person" description="They'll get an email with a link to choose their own password." back={{ href: "/team", label: "Team" }} />
      <EmployeeForm
        id={null}
        departments={departments.map((d) => ({ value: d.id, label: d.name }))}
        defaults={{ name: "", email: "", role: "EMPLOYEE", phone: "", departmentId: "", designation: "", joiningDate: "", hourlyCost: "", dailyDigest: false, emailOnTask: false }}
      />
    </div>
  );
}
