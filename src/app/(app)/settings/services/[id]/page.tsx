import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import type { BILLING_TYPES } from "@/lib/validators/catalogue";
import { ServiceForm } from "../service-form";
import { SubServicesEditor } from "../sub-services-editor";
import { TemplatesEditor } from "../templates-editor";

export const metadata: Metadata = { title: "Service" };

type Kpi = { metric: string; unit: string };
type Deliverable = { name: string; qty: number; unit: string };

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const service = await db.service.findUnique({
    where: { id },
    include: {
      subServices: { orderBy: { sortOrder: "asc" } },
      taskTemplates: { orderBy: { createdAt: "asc" }, include: { steps: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!service) notFound();
  const usedDepartments = service.taskTemplates.flatMap((t) => t.steps.map((s) => s.departmentId)).filter((d): d is string => !!d);
  const departments = await db.department.findMany({
    where: { OR: [{ isActive: true }, { id: { in: [...usedDepartments, ...(service.departmentId ? [service.departmentId] : [])] } }] },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <div className="space-y-4">
      <PageHeader title={service.name} back={{ href: "/settings/services", label: "Service catalogue" }} />
      <ServiceForm
        serviceId={service.id}
        departments={departmentOptions}
        defaults={{
          name: service.name,
          departmentId: service.departmentId ?? "",
          billingType: service.billingType,
          defaultPrice: service.defaultPrice.toString(),
          unit: service.unit,
          gstRate: service.gstRate.toString(),
          sacCode: service.sacCode ?? "",
          revisionsIncluded: service.revisionsIncluded,
          isActive: service.isActive,
          defaultKpis: (service.defaultKpis as Kpi[] | null) ?? [],
          defaultDeliverables: (service.defaultDeliverables as Deliverable[] | null) ?? [],
        }}
      />
      <SubServicesEditor
        serviceId={service.id}
        items={service.subServices.map((s) => ({
          id: s.id,
          name: s.name,
          billingType: (s.billingType ?? "") as (typeof BILLING_TYPES)[number] | "",
          defaultPrice: s.defaultPrice?.toString() ?? "",
          unit: s.unit ?? "",
          isActive: s.isActive,
        }))}
      />
      <TemplatesEditor
        serviceId={service.id}
        departments={departmentOptions}
        subServices={service.subServices.map((s) => ({ value: s.id, label: s.name }))}
        templates={service.taskTemplates.map((t) => ({
          id: t.id,
          serviceId: service.id,
          subServiceId: t.subServiceId ?? "",
          name: t.name,
          isActive: t.isActive,
          steps: t.steps.map((s) => ({
            title: s.title,
            departmentId: s.departmentId ?? "",
            durationDays: s.durationDays,
            priority: s.priority,
            isClientApproval: s.isClientApproval,
          })),
        }))}
      />
    </div>
  );
}
