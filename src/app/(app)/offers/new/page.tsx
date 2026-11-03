import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getOfferFormOptions, getTemplates } from "@/server/queries/offers";
import { newOfferValues } from "../form-values";
import { OfferForm } from "../offer-form";
import { TemplatePicker } from "./template-picker";

export const metadata: Metadata = { title: "New offer" };

export default async function NewOfferPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("sales.manage");
  const sp = await searchParams;
  const templateId = idParam(sp, "template");
  const [options, templates, template] = await Promise.all([
    getOfferFormOptions(),
    getTemplates(),
    templateId
      ? db.offer.findFirst({
          where: { id: templateId, isTemplate: true, archivedAt: null },
          include: { items: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sortOrder: "asc" } } },
        })
      : null,
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="New offer" back={{ href: "/offers", label: "Offers" }} />
      {templates.length > 0 && (
        <TemplatePicker selected={templateId ?? ""} templates={templates.map((t) => ({ value: t.id, label: t.templateName ?? t.title }))} />
      )}
      <OfferForm
        key={templateId ?? "blank"}
        mode={{ kind: "offer", offerId: null }}
        options={options}
        defaults={newOfferValues(options, { clientId: idParam(sp, "client"), leadId: idParam(sp, "lead"), template })}
      />
    </div>
  );
}
