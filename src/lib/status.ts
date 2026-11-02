/**
 * One colour language for every status badge in the app:
 * green = done/paid, amber = pending/due soon, red = overdue/rejected,
 * grey = draft/archived, blue = in progress/active, violet = waiting on client.
 */
export type Tone = "green" | "amber" | "red" | "grey" | "blue" | "violet";

type StatusDef = { label: string; tone: Tone };

export const STATUS: Record<string, Record<string, StatusDef>> = {
  lead: {
    NEW: { label: "New", tone: "blue" },
    CONTACTED: { label: "Contacted", tone: "amber" },
    REQUIREMENT_DISCUSSED: { label: "Requirement Discussed", tone: "amber" },
    OFFER_SENT: { label: "Offer Sent", tone: "violet" },
    WON: { label: "Won", tone: "green" },
    LOST: { label: "Lost", tone: "red" },
  },
  offer: {
    DRAFT: { label: "Draft", tone: "grey" },
    SENT: { label: "Sent", tone: "blue" },
    ON_HOLD: { label: "On Hold", tone: "amber" },
    ACCEPTED: { label: "Accepted", tone: "green" },
    REJECTED: { label: "Rejected", tone: "red" },
    EXPIRED: { label: "Expired", tone: "grey" },
  },
  client: {
    ACTIVE: { label: "Active", tone: "green" },
    INACTIVE: { label: "Inactive", tone: "amber" },
    ARCHIVED: { label: "Archived", tone: "grey" },
  },
  project: {
    NOT_STARTED: { label: "Not Started", tone: "grey" },
    ACTIVE: { label: "Active", tone: "blue" },
    ON_HOLD: { label: "On Hold", tone: "amber" },
    COMPLETED: { label: "Completed", tone: "green" },
    CANCELLED: { label: "Cancelled", tone: "red" },
  },
  health: {
    ON_TRACK: { label: "On Track", tone: "green" },
    AT_RISK: { label: "At Risk", tone: "amber" },
    DELAYED: { label: "Delayed", tone: "red" },
  },
  task: {
    TODO: { label: "To Do", tone: "grey" },
    IN_PROGRESS: { label: "In Progress", tone: "blue" },
    IN_REVIEW: { label: "In Review", tone: "amber" },
    WAITING_CLIENT_APPROVAL: { label: "Waiting for Client", tone: "violet" },
    DONE: { label: "Done", tone: "green" },
    BLOCKED: { label: "Blocked", tone: "red" },
  },
  priority: {
    LOW: { label: "Low", tone: "grey" },
    MEDIUM: { label: "Medium", tone: "blue" },
    HIGH: { label: "High", tone: "amber" },
    URGENT: { label: "Urgent", tone: "red" },
  },
  invoice: {
    DRAFT: { label: "Draft", tone: "grey" },
    ISSUED: { label: "Issued", tone: "blue" },
    CANCELLED: { label: "Cancelled", tone: "grey" },
    CONVERTED: { label: "Converted", tone: "green" },
  },
  payment: {
    UNPAID: { label: "Unpaid", tone: "amber" },
    PARTIALLY_PAID: { label: "Partially Paid", tone: "amber" },
    PAID: { label: "Paid", tone: "green" },
    OVERDUE: { label: "Overdue", tone: "red" },
    CANCELLED: { label: "Cancelled", tone: "grey" },
    NONE: { label: "No invoices", tone: "grey" },
  },
  severity: {
    INFO: { label: "Info", tone: "blue" },
    WARNING: { label: "Warning", tone: "amber" },
    CRITICAL: { label: "Critical", tone: "red" },
  },
};

export function statusDef(kind: keyof typeof STATUS | string, value: string | null | undefined): StatusDef {
  if (!value) return { label: "—", tone: "grey" };
  return STATUS[kind]?.[value] ?? { label: humanize(value), tone: "grey" };
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
