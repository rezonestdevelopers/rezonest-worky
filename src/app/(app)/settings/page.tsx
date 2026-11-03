import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import type { SettingsInput } from "@/lib/validators/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const s = await db.settings.findUniqueOrThrow({ where: { id: "agency" } });

  const defaults: SettingsInput = {
    agencyName: s.agencyName,
    address: s.address,
    city: s.city ?? "",
    state: s.state,
    stateCode: s.stateCode,
    pincode: s.pincode ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    website: s.website ?? "",
    gstin: s.gstin ?? "",
    pan: s.pan ?? "",
    bankName: s.bankName ?? "",
    bankAccountName: s.bankAccountName ?? "",
    bankAccountNumber: s.bankAccountNumber ?? "",
    bankIfsc: s.bankIfsc ?? "",
    bankBranch: s.bankBranch ?? "",
    upiId: s.upiId ?? "",
    quotationTerms: s.quotationTerms ?? "",
    invoiceTerms: s.invoiceTerms ?? "",
    quotationFormat: s.quotationFormat,
    proformaFormat: s.proformaFormat,
    invoiceFormat: s.invoiceFormat,
    creditNoteFormat: s.creditNoteFormat,
    seqPadding: s.seqPadding,
    defaultGstRate: Number(s.defaultGstRate.toString()),
    gstEnabledByDefault: s.gstEnabledByDefault,
    defaultPaymentTermsDays: s.defaultPaymentTermsDays,
    paymentTermOptions: s.paymentTermOptions.join(", "),
    offerValidityDays: s.offerValidityDays,
    digestTime: s.digestTime,
    digestEnabled: s.digestEnabled,
    workingDays: s.workingDays,
    renewalAlertDays: s.renewalAlertDays.join(", "),
    approvalWaitDays: s.approvalWaitDays,
    dueSoonDays: s.dueSoonDays,
    adBudgetAlertPercent: s.adBudgetAlertPercent,
    retainerEndingDays: s.retainerEndingDays,
    shortfallDaysLeft: s.shortfallDaysLeft,
    retainerTaskDay: s.retainerTaskDay,
    accentColor: s.accentColor,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Agency details, GST, numbering and reminder rules. Every change is recorded in the activity log.</p>
      </div>
      <SettingsForm defaults={defaults} logoUrl={fileUrl(s.logoKey)} signatureUrl={fileUrl(s.signatureKey)} />
    </div>
  );
}
