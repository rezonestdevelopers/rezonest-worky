export type GoLiveInput = {
  authSecret?: string;
  appUrl?: string;
  cronSecret?: string;
  smtpHost?: string;
  storageDriver?: string;
  defaultPasswordUsers: string[];
  sampleDataPresent: boolean;
  gstin?: string | null;
  bankAccount?: string | null;
  upiId?: string | null;
  invoiceTerms?: string | null;
  signatureKey?: string | null;
  servicesMissingSac: number;
  lastBackupDay?: string | null;
  today: string;
};

export type GoLiveItem = { level: "must" | "should"; text: string };

/** What still stands between this copy and real use. "must" items would cause real harm if live. */
export function goLiveProblems(i: GoLiveInput): GoLiveItem[] {
  const out: GoLiveItem[] = [];
  const must = (text: string) => out.push({ level: "must", text });
  const should = (text: string) => out.push({ level: "should", text });

  if (!i.authSecret || i.authSecret.length < 32 || /change|example|secret/i.test(i.authSecret)) must("Set AUTH_SECRET to a long random value. Client links depend on it, so don't change it afterwards.");
  if (!i.appUrl || !i.appUrl.startsWith("https://")) must("Set APP_URL to your live https:// address. Client links and emails use it.");
  if (!i.cronSecret || i.cronSecret.length < 24) must("Set CRON_SECRET to a long random value, so scheduled jobs are protected.");
  if (!i.smtpHost) must("Add your email (SMTP) details. Until then, no email leaves the app, including password resets.");
  if (i.defaultPasswordUsers.length) must(`Change the sample password for: ${i.defaultPasswordUsers.join(", ")}. Use My account, or deactivate them.`);
  if (i.sampleDataPresent) must("Remove the sample data with: pnpm db:wipe-sample. This deletes all clients, invoices and payments in this database.");
  if (!i.gstin) must("Add your GSTIN in Settings → GST & Bank. GST tax invoices can't be issued without it.");

  if (i.storageDriver !== "s3") should("Use cloud storage (STORAGE_DRIVER=\"s3\"), so uploaded files and backups survive if the server fails.");
  if (!i.bankAccount) should("Add your bank details in Settings → GST & Bank, so they print on invoices.");
  if (!i.upiId) should("Add your UPI ID in Settings → GST & Bank, so invoices carry a QR code.");
  if (!i.invoiceTerms) should("Add your invoice terms in Settings.");
  if (!i.signatureKey) should("Upload your signature in Settings → Branding.");
  if (i.servicesMissingSac) should(`Add SAC codes to ${i.servicesMissingSac} service${i.servicesMissingSac === 1 ? "" : "s"} in Settings → Service catalogue.`);
  if (i.lastBackupDay !== i.today) should("No backup has finished today. Run one from Settings → Backups, and check it worked.");
  return out;
}
