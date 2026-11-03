import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { getOfferFormOptions } from "@/server/queries/offers";
import { newOfferValues } from "../../form-values";
import { OfferForm } from "../../offer-form";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requirePermission("sales.manage");
  const options = await getOfferFormOptions();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="New template" back={{ href: "/offers/templates", label: "Offer templates" }} />
      <OfferForm mode={{ kind: "template", templateId: null }} options={options} defaults={newOfferValues(options, {})} />
    </div>
  );
}
