import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { retainerEndKey } from "@/lib/work-plan";
import { ConvertForm, type ConvertTargetRow } from "./convert-form";

export const metadata: Metadata = { title: "Convert to project" };

/** The usual web project stages. Only used when the offer has no payment milestones of its own. */
const DEFAULT_MILESTONES = ["Requirements & Specs", "UI/UX Design", "Development", "Testing", "Launch"];

export default async function ConvertOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("work.manage");
  const { id } = await params;
  const offer = await db.offer.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { service: { select: { id: true, name: true, defaultKpis: true } } } },
      milestones: { orderBy: { sortOrder: "asc" } },
      client: { select: { companyName: true, accountManagerId: true } },
      project: { select: { id: true } },
    },
  });
  if (!offer || offer.isTemplate) notFound();
  if (offer.project) redirect(`/projects/${offer.project.id}`);
  if (offer.status !== "ACCEPTED" || !offer.clientId) redirect(`/offers/${id}`);

  const users = await db.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const today = todayKey();
  const isRetainer = offer.items.some((i) => i.billingType === "MONTHLY_RETAINER");
  const months = offer.durationMonths ?? Math.max(0, ...offer.items.map((i) => i.durationMonths ?? 0));
  const retainerEnd = isRetainer ? retainerEndKey(today, months || 12) : "";
  const hasMilestoneWork = offer.items.some((i) => i.billingType === "MILESTONE");
  const skipped = offer.items.filter((i) => !i.serviceId).map((i) => i.description);

  const milestones = offer.milestones.length
    ? offer.milestones.map((m) => ({ name: m.name, dueDate: "", paymentPercent: m.percent.toString() }))
    : hasMilestoneWork
      ? DEFAULT_MILESTONES.map((name) => ({ name, dueDate: "", paymentPercent: "" }))
      : [];

  const seen = new Set<string>();
  const targets: ConvertTargetRow[] = [];
  for (const item of offer.items) {
    if (!item.service || seen.has(item.service.id)) continue;
    seen.add(item.service.id);
    for (const k of (item.service.defaultKpis as { metric: string; unit: string }[] | null) ?? []) {
      targets.push({ serviceId: item.service.id, serviceName: item.service.name, metric: k.metric, unit: k.unit, targetValue: "", higherIsBetter: !/^c(pl|ost)/i.test(k.metric) });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Convert to project"
        description={`${offer.number} for ${offer.client?.companyName}. Services, prices and terms are copied from the offer.`}
        back={{ href: `/offers/${id}`, label: "Back to offer" }}
      />
      <ConvertForm
        offerId={id}
        isRetainer={isRetainer}
        people={users.map((u) => ({ value: u.id, label: u.name }))}
        skipped={skipped}
        defaults={{
          offerId: id,
          name: offer.title,
          managerId: offer.client?.accountManagerId ?? user.id,
          startDate: today,
          deadline: "",
          retainerEnd,
          autoRenew: false,
          milestones,
          targets,
          createTasks: true,
        }}
      />
    </div>
  );
}
