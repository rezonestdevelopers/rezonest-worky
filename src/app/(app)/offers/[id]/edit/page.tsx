import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getOfferFormOptions } from "@/server/queries/offers";
import { offerToFormValues } from "../../form-values";
import { OfferForm } from "../../offer-form";

export const metadata: Metadata = { title: "Edit offer" };

export default async function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { id } = await params;
  const offer = await db.offer.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sortOrder: "asc" } } },
  });
  if (!offer || offer.isTemplate) notFound();
  if (offer.status !== "DRAFT" || offer.archivedAt) redirect(`/offers/${id}`);
  const options = await getOfferFormOptions();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={`Edit ${offer.number}${offer.currentVersion > 1 ? ` (v${offer.currentVersion})` : ""}`} back={{ href: `/offers/${id}`, label: "Back to offer" }} />
      <OfferForm mode={{ kind: "offer", offerId: id }} options={options} defaults={offerToFormValues(offer)} />
    </div>
  );
}
