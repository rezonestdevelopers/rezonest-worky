import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage() {
  await requirePermission("settings.manage");
  const departments = await db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const settings = await db.settings.findUnique({ where: { id: "agency" }, select: { defaultGstRate: true } });
  return (
    <div className="space-y-4">
      <PageHeader title="New service" description="Save the basics first. You can then add sub-services and task templates." back={{ href: "/settings/services", label: "Service catalogue" }} />
      <ServiceForm
        serviceId={null}
        departments={departments.map((d) => ({ value: d.id, label: d.name }))}
        defaults={{
          name: "", departmentId: "", billingType: "MONTHLY_RETAINER", defaultPrice: "0", unit: "month",
          gstRate: settings?.defaultGstRate.toString() ?? "18", sacCode: "", revisionsIncluded: 2, isActive: true, defaultKpis: [], defaultDeliverables: [],
        }}
      />
    </div>
  );
}
