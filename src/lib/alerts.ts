export type AlertCategory =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "approval"
  | "follow_up"
  | "payment"
  | "renewal"
  | "ads"
  | "shortfall"
  | "retainer"
  | "deadline"
  | "milestone"
  | "onboarding";

export const ALERT_CATEGORIES: Record<AlertCategory, string> = {
  overdue: "Overdue tasks",
  due_today: "Due today",
  due_soon: "Due soon",
  approval: "Waiting for client",
  follow_up: "Follow-ups",
  payment: "Payments",
  renewal: "Renewals",
  ads: "Ad budget",
  shortfall: "Delivery shortfall",
  retainer: "Retainers ending",
  deadline: "Project deadlines",
  milestone: "Milestones",
  onboarding: "Onboarding",
};

const TYPE_CATEGORY: Record<string, AlertCategory> = {
  TASK_OVERDUE: "overdue",
  TASK_DUE_TODAY: "due_today",
  TASK_DUE_SOON: "due_soon",
  WAITING_APPROVAL: "approval",
  LEAD_FOLLOW_UP: "follow_up",
  OFFER_FOLLOW_UP: "follow_up",
  OFFER_EXPIRING: "follow_up",
  COMMUNICATION_NEXT_ACTION: "follow_up",
  INVOICE_DUE: "payment",
  PAYMENT_OVERDUE: "payment",
  RENEWAL_DUE: "renewal",
  AD_BUDGET_ALERT: "ads",
  DELIVERY_SHORTFALL: "shortfall",
  RETAINER_ENDING: "retainer",
  PROJECT_DEADLINE: "deadline",
  MILESTONE_DUE: "milestone",
  ONBOARDING_PENDING: "onboarding",
};

export const categoryOfType = (type: string): AlertCategory => TYPE_CATEGORY[type] ?? "follow_up";
export const typesOfCategory = (category: string) => Object.keys(TYPE_CATEGORY).filter((t) => TYPE_CATEGORY[t] === category);

/** These show money or lead to Admin-only pages, so Managers don't get them. */
export const MONEY_TYPES = ["INVOICE_DUE", "PAYMENT_OVERDUE", "RENEWAL_DUE"];

export type ReminderRowState = { status: "OPEN" | "SNOOZED" | "DONE"; snoozedUntil: Date | null; doneManually: boolean };

/**
 * What a daily run should do with one reminder. `present` means the situation still exists.
 * Someone's Done stays done. A snooze wakes when its time is up. If the situation has gone, it closes by
 * itself, and if it comes back later (a closed task reopened), so does the reminder.
 */
export function nextReminderState(row: ReminderRowState, present: boolean, now: Date): "OPEN" | "SNOOZED" | "DONE" {
  if (row.status === "DONE") return present && !row.doneManually ? "OPEN" : "DONE";
  if (!present) return "DONE";
  if (row.status === "SNOOZED" && row.snoozedUntil && row.snoozedUntil > now) return "SNOOZED";
  return "OPEN";
}

export type DigestAlert = { category: AlertCategory; severity: string; title: string; detail: string | null };
export type DigestSection = { title: string; total: number; lines: string[]; more: number };

/** Groups reminders into the digest's sections, in the order they matter, keeping each one short. */
export function digestSections(alerts: DigestAlert[], perSection = 15): DigestSection[] {
  const rank: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return (Object.keys(ALERT_CATEGORIES) as AlertCategory[]).flatMap((category) => {
    const items = alerts.filter((a) => a.category === category).sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
    if (!items.length) return [];
    return [{
      title: ALERT_CATEGORIES[category],
      total: items.length,
      lines: items.slice(0, perSection).map((a) => `${a.title}${a.detail ? `: ${a.detail}` : ""}`),
      more: Math.max(0, items.length - perSection),
    }];
  });
}

export function digestText(sections: DigestSection[]): string {
  return sections
    .map((s) => [`${s.title.toUpperCase()} (${s.total})`, ...s.lines.map((l) => `- ${l}`), ...(s.more ? [`...and ${s.more} more`] : [])].join("\n"))
    .join("\n\n");
}

/** The digest's one-line headline. */
export function digestSummary(alerts: DigestAlert[]): string {
  if (!alerts.length) return "All clear today";
  const urgent = alerts.filter((a) => a.severity !== "INFO").length;
  return urgent ? `${urgent} need${urgent === 1 ? "s" : ""} attention` : `${alerts.length} for your information`;
}

/** Is it digest time yet? Times are "HH:MM", so they compare as text. A late run still sends the same day. */
export const digestDue = (nowTime: string, digestTime: string) => nowTime >= digestTime;
