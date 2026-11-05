import { exportValue } from "@/lib/csv";
import type { Db, Tx } from "./shared";

/**
 * Tables you can download. Each is a list of its columns as stored. Password hashes aren't exported at
 * all, and neither are reset tokens, client link records or the app's internal run markers.
 */
export const EXPORT_TABLES: { key: string; label: string; omit?: string[] }[] = [
  { key: "client", label: "Clients" },
  { key: "clientContact", label: "Client contacts" },
  { key: "lead", label: "Leads" },
  { key: "leadStageHistory", label: "Lead stage history" },
  { key: "offer", label: "Offers" },
  { key: "offerItem", label: "Offer items" },
  { key: "offerMilestone", label: "Offer milestones" },
  { key: "offerVersion", label: "Offer versions" },
  { key: "offerStatusHistory", label: "Offer status history" },
  { key: "onboardingChecklist", label: "Onboarding checklists" },
  { key: "onboardingItem", label: "Onboarding items" },
  { key: "project", label: "Projects" },
  { key: "projectService", label: "Project services" },
  { key: "milestone", label: "Milestones" },
  { key: "target", label: "Targets" },
  { key: "targetProgress", label: "Target progress" },
  { key: "deliverable", label: "Deliverables" },
  { key: "task", label: "Tasks" },
  { key: "taskChecklistItem", label: "Task checklists" },
  { key: "taskComment", label: "Task comments" },
  { key: "timeLog", label: "Time logs" },
  { key: "changeRequest", label: "Change requests" },
  { key: "contentCalendarItem", label: "Content calendar" },
  { key: "contentApproval", label: "Content approvals" },
  { key: "adCampaign", label: "Ad campaigns" },
  { key: "adSpendEntry", label: "Ad spend entries" },
  { key: "domainHostingAsset", label: "Domains & hosting" },
  { key: "invoice", label: "Invoices" },
  { key: "invoiceItem", label: "Invoice items" },
  { key: "creditNote", label: "Credit notes" },
  { key: "payment", label: "Payments" },
  { key: "paymentAllocation", label: "Payment allocations" },
  { key: "expense", label: "Expenses" },
  { key: "document", label: "Documents (list only)" },
  { key: "communicationLog", label: "Communication log" },
  { key: "clientReportNote", label: "Client report notes" },
  { key: "reminder", label: "Reminders" },
  { key: "activityLog", label: "Activity log" },
  { key: "user", label: "Users", omit: ["passwordHash"] },
  { key: "employeeProfile", label: "Employee profiles" },
  { key: "department", label: "Departments" },
  { key: "sector", label: "Sectors" },
  { key: "leadSource", label: "Lead sources" },
  { key: "service", label: "Services" },
  { key: "subService", label: "Sub-services" },
  { key: "taskTemplate", label: "Task templates" },
  { key: "taskTemplateStep", label: "Task template steps" },
  { key: "emailTemplate", label: "Email templates" },
  { key: "settings", label: "Settings" },
];

export const exportTable = (key: string) => EXPORT_TABLES.find((t) => t.key === key);

type Delegate = { findMany: (args: { orderBy: { id: "asc" }; take: number }) => Promise<Record<string, unknown>[]> };

export async function exportRows(db: Db | Tx, key: string) {
  const table = exportTable(key);
  if (!table) return null;
  const delegate = (db as unknown as Record<string, Delegate>)[key];
  const rows = await delegate.findMany({ orderBy: { id: "asc" }, take: 500_000 });
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !table.omit?.includes(k)).map(([k, v]) => [k, exportValue(v)])));
}
