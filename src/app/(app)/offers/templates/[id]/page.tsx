import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getOfferFormOptions } from "@/server/queries/offers";
import { offerToFormValues } from "../../form-values";
import { OfferForm } from "../../offer-form";

export const metadata: Metadata = { title: "Edit template" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  const template = await db.offer.findFirst({
    where: { id, isTemplate: true },
    include: { items: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sortOrder: "asc" } } },
  });
  if (!template) notFound();
  const options = await getOfferFormOptions();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={template.templateName ?? template.title} back={{ href: "/offers/templates", label: "Offer templates" }} />
      <OfferForm mode={{ kind: "template", templateId: id }} options={options} defaults={offerToFormValues(template)} />
    </div>
  );
}
