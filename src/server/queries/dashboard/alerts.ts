import "server-only";
import type { ReminderType } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal, formatINR, toDecimal } from "@/lib/money";
import { addDaysKey, dateOnlyKey, daysBetweenKeys, formatDateKey, keyToDate, monthRange } from "@/lib/dates";
import type { Scope } from "./filters";

export type AlertCategory =
  | "overdue"
  | "due_today"
  | "approval"
  | "follow_up"
  | "payment"
  | "renewal"
  | "ads"
  | "shortfall"
  | "retainer"
  | "milestone"
  | "onboarding";

export const ALERT_CATEGORIES: Record<AlertCategory, string> = {
  overdue: "Overdue tasks",
  due_today: "Due today",
  approval: "Waiting for client",
  follow_up: "Follow-ups",
  payment: "Payments",
  renewal: "Renewals",
  ads: "Ad budget",
  shortfall: "Delivery shortfall",
  retainer: "Retainers ending",
  milestone: "Milestones",
  onboarding: "Onboarding",
};

export type Alert = {
  key: string; // dedupe key — stable per item (used for snooze / done)
  type: ReminderType;
  category: AlertCategory;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  href: string;
  entityType: string;
  entityId: string;
  dateKey?: string;
};

/**
 * Builds the alerts list LIVE from current data (Phase 1).
 * Phase 6 moves this into the daily reminder job that stores Reminder rows;
 * the dedupe keys used here are the same, so snoozes carry over.
 */
export async function getAlerts(scope: Scope, opts: { money: boolean; settings: { approvalWaitDays: number; adBudgetAlertPercent: number; retainerEndingDays: number; shortfallDaysLeft: number; renewalAlertDays: number[] } }) {
  const T = scope.today;
  const today = keyToDate(T);
  const s = opts.settings;
  const alerts: Alert[] = [];

  const [overdue, dueToday, waiting, leads, offers, invoices, assets, campaigns, retainers, milestones, onboarding, comms] = await Promise.all([
    db.task.findMany({
      where: { ...scope.taskWhere, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 100,
      select: { id: true, title: true, dueDate: true, status: true, client: { select: { companyName: true } }, assignee: { select: { name: true } } },
    }),
    db.task.findMany({
      where: { ...scope.taskWhere, status: { not: "DONE" }, dueDate: today },
      take: 50,
      select: { id: true, title: true, client: { select: { companyName: true } }, assignee: { select: { name: true } } },
    }),
    db.task.findMany({
      where: { ...scope.taskWhere, status: "WAITING_CLIENT_APPROVAL", statusChangedAt: { lte: new Date(Date.now() - s.approvalWaitDays * 86_400_000) } },
      take: 50,
      select: { id: true, title: true, statusChangedAt: true, client: { select: { companyName: true } } },
    }),
    db.lead.findMany({
      where: { archivedAt: null, stage: { notIn: ["WON", "LOST"] }, nextFollowUpDate: { lte: today }, ...(scope.f.sectorId ? { sectorId: scope.f.sectorId } : {}) },
      select: { id: true, contactName: true, companyName: true, nextFollowUpDate: true, stage: true },
    }),
    db.offer.findMany({
      where: {
        archivedAt: null,
        isTemplate: false,
        status: { in: ["SENT", "ON_HOLD"] },
        OR: [{ followUpDate: { lte: today } }, { validUntil: { lte: keyToDate(addDaysKey(T, 3)) } }],
      },
      select: { id: true, number: true, title: true, followUpDate: true, validUntil: true, client: { select: { companyName: true } }, lead: { select: { companyName: true } } },
    }),
    opts.money
      ? db.invoice.findMany({
          where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 }, dueDate: { lte: keyToDate(addDaysKey(T, 3)) }, client: scope.clientWhere },
          orderBy: { dueDate: "asc" },
          select: { id: true, number: true, dueDate: true, balanceDue: true, client: { select: { companyName: true } } },
        })
      : [],
    db.domainHostingAsset.findMany({
      where: { archivedAt: null, expiryDate: { lte: keyToDate(addDaysKey(T, Math.max(...s.renewalAlertDays, 30))) }, client: scope.clientWhere },
      orderBy: { expiryDate: "asc" },
      select: { id: true, name: true, kind: true, expiryDate: true, client: { select: { companyName: true } } },
    }),
    db.adCampaign.findMany({
      where: { archivedAt: null, status: "ACTIVE", client: scope.clientWhere },
      select: { id: true, name: true, plannedBudget: true, client: { select: { companyName: true } }, entries: { select: { spend: true } } },
    }),
    db.project.findMany({
      where: { ...scope.projectWhere, status: "ACTIVE", isRetainer: true, retainerEnd: { gte: today, lte: keyToDate(addDaysKey(T, s.retainerEndingDays)) } },
      select: { id: true, name: true, retainerEnd: true, autoRenew: true, client: { select: { companyName: true } } },
    }),
    db.milestone.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: { lte: keyToDate(addDaysKey(T, 7)) }, project: { ...scope.projectWhere, status: "ACTIVE" } },
      select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
    }),
    db.onboardingItem.findMany({
      where: {
        isDone: false,
        checklist: { project: { ...scope.projectWhere, status: "ACTIVE", startDate: { lte: keyToDate(addDaysKey(T, -7)) } } },
      },
      select: { id: true, title: true, checklist: { select: { project: { select: { id: true, name: true } } } } },
    }),
    db.communicationLog.findMany({
      where: { nextActionDate: { lte: today, gte: keyToDate(addDaysKey(T, -14)) }, nextAction: { not: null }, client: scope.clientWhere },
      select: { id: true, clientId: true, nextAction: true, nextActionDate: true, client: { select: { companyName: true } } },
    }),
  ]);

  for (const t of overdue) {
    const days = daysBetweenKeys(dateOnlyKey(t.dueDate!), T);
    alerts.push({
      key: `TASK_OVERDUE:${t.id}`, type: "TASK_OVERDUE", category: "overdue", severity: days > 3 || t.status === "BLOCKED" ? "CRITICAL" : "WARNING",
      title: t.title, detail: `${t.client?.companyName ?? ""} · ${t.assignee?.name ?? "Unassigned"} · ${days} day${days === 1 ? "" : "s"} overdue${t.status === "BLOCKED" ? " · Blocked" : ""}`,
      href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, dateKey: dateOnlyKey(t.dueDate!),
    });
  }
  for (const t of dueToday) {
    alerts.push({
      key: `TASK_DUE_TODAY:${t.id}:${T}`, type: "TASK_DUE_TODAY", category: "due_today", severity: "INFO",
      title: t.title, detail: `${t.client?.companyName ?? ""} · ${t.assignee?.name ?? "Unassigned"}`, href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, dateKey: T,
    });
  }
  for (const t of waiting) {
    const days = Math.floor((Date.now() - t.statusChangedAt.getTime()) / 86_400_000);
    alerts.push({
      key: `WAITING_APPROVAL:${t.id}`, type: "WAITING_APPROVAL", category: "approval", severity: days >= 5 ? "CRITICAL" : "WARNING",
      title: t.title, detail: `${t.client?.companyName ?? ""} · waiting ${days} days for client approval`, href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id,
    });
  }
  for (const l of leads) {
    const due = dateOnlyKey(l.nextFollowUpDate!);
    alerts.push({
      key: `LEAD_FOLLOW_UP:${l.id}:${due}`, type: "LEAD_FOLLOW_UP", category: "follow_up", severity: due < T ? "WARNING" : "INFO",
      title: `Follow up: ${l.companyName ?? l.contactName}`, detail: `Lead · ${due < T ? `was due ${formatDateKey(due)}` : "due today"}`, href: `/leads/${l.id}`, entityType: "Lead", entityId: l.id, dateKey: due,
    });
  }
  for (const o of offers) {
    const who = o.client?.companyName ?? o.lead?.companyName ?? "";
    const valid = dateOnlyKey(o.validUntil);
    if (o.followUpDate && dateOnlyKey(o.followUpDate) <= T) {
      const due = dateOnlyKey(o.followUpDate);
      alerts.push({
        key: `OFFER_FOLLOW_UP:${o.id}:${due}`, type: "OFFER_FOLLOW_UP", category: "follow_up", severity: due < T ? "WARNING" : "INFO",
        title: `Follow up offer ${o.number}`, detail: `${who} · ${o.title}`, href: `/offers/${o.id}`, entityType: "Offer", entityId: o.id, dateKey: due,
      });
    }
    if (valid <= addDaysKey(T, 3)) {
      const days = daysBetweenKeys(T, valid);
      alerts.push({
        key: `OFFER_EXPIRING:${o.id}:${valid}`, type: "OFFER_EXPIRING", category: "follow_up", severity: days <= 1 ? "CRITICAL" : "WARNING",
        title: `Offer ${o.number} ${days < 0 ? "has expired" : days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`}`,
        detail: `${who} · valid until ${formatDateKey(valid)}`, href: `/offers/${o.id}`, entityType: "Offer", entityId: o.id, dateKey: valid,
      });
    }
  }
  for (const i of invoices) {
    const due = dateOnlyKey(i.dueDate);
    const days = daysBetweenKeys(due, T);
    const overdueInv = days > 0;
    alerts.push({
      key: `${overdueInv ? "PAYMENT_OVERDUE" : "INVOICE_DUE"}:${i.id}`, type: overdueInv ? "PAYMENT_OVERDUE" : "INVOICE_DUE", category: "payment",
      severity: days > 30 ? "CRITICAL" : overdueInv ? "WARNING" : "INFO",
      title: `${i.client.companyName} owes ${formatINR(i.balanceDue)}`,
      detail: `${i.number} · ${overdueInv ? `${days} days overdue` : days === 0 ? "due today" : `due ${formatDateKey(due)}`}`,
      href: `/invoices/${i.id}`, entityType: "Invoice", entityId: i.id, dateKey: due,
    });
  }
  for (const a of assets) {
    const exp = dateOnlyKey(a.expiryDate);
    const days = daysBetweenKeys(T, exp);
    // threshold bucket so that a snooze at "30 days" re-alerts at 15 / 7 / 1
    const threshold = [...s.renewalAlertDays].sort((x, y) => x - y).find((d) => days <= d) ?? 0;
    const kind = a.kind === "BUSINESS_EMAIL" ? "Business email" : a.kind.charAt(0) + a.kind.slice(1).toLowerCase();
    alerts.push({
      key: `RENEWAL_DUE:${a.id}:${exp}:${days < 0 ? "expired" : threshold}`, type: "RENEWAL_DUE", category: "renewal",
      severity: days <= 7 ? "CRITICAL" : days <= 15 ? "WARNING" : "INFO",
      title: `${kind} ${days < 0 ? "expired" : days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`}: ${a.name}`,
      detail: `${a.client.companyName} · ${formatDateKey(exp)}`, href: "/renewals", entityType: "DomainHostingAsset", entityId: a.id, dateKey: exp,
    });
  }
  for (const c of campaigns) {
    const spent = c.entries.reduce((sum, e) => sum.plus(toDecimal(e.spend)), new Decimal(0));
    const budget = toDecimal(c.plannedBudget);
    if (budget.isZero()) continue;
    const pct = spent.dividedBy(budget).times(100).toNumber();
    if (pct >= s.adBudgetAlertPercent) {
      alerts.push({
        key: `AD_BUDGET_ALERT:${c.id}`, type: "AD_BUDGET_ALERT", category: "ads", severity: pct >= 100 ? "CRITICAL" : "WARNING",
        title: `${c.client.companyName}: ${Math.round(pct)}% of ad budget used`, detail: `${c.name} · ${formatINR(spent, { decimals: false })} of ${formatINR(budget, { decimals: false })} (client's budget)`,
        href: "/ads", entityType: "AdCampaign", entityId: c.id,
      });
    }
  }
  // retainer delivery shortfall — only in the last N days of the month
  const { end } = monthRange(T);
  const daysLeft = daysBetweenKeys(T, end);
  if (daysLeft < s.shortfallDaysLeft) {
    const month = T.slice(0, 7);
    const rows = await db.deliverable.groupBy({
      by: ["projectId"],
      where: { month, project: { ...scope.projectWhere, status: "ACTIVE", isRetainer: true } },
      _count: { _all: true, deliveredAt: true },
    });
    const short = rows.filter((r) => r._count.deliveredAt < r._count._all);
    const projects = await db.project.findMany({ where: { id: { in: short.map((r) => r.projectId) } }, select: { id: true, name: true } });
    for (const r of short) {
      const p = projects.find((x) => x.id === r.projectId);
      alerts.push({
        key: `DELIVERY_SHORTFALL:${r.projectId}:${month}`, type: "DELIVERY_SHORTFALL", category: "shortfall", severity: "WARNING",
        title: `${p?.name}: ${r._count.deliveredAt}/${r._count._all} delivered`, detail: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month`,
        href: `/projects/${r.projectId}`, entityType: "Project", entityId: r.projectId,
      });
    }
  }
  for (const p of retainers) {
    const endKey = dateOnlyKey(p.retainerEnd!);
    const days = daysBetweenKeys(T, endKey);
    alerts.push({
      key: `RETAINER_ENDING:${p.id}:${endKey}`, type: "RETAINER_ENDING", category: "retainer", severity: days <= 7 ? "WARNING" : "INFO",
      title: `${p.name} ends in ${days} day${days === 1 ? "" : "s"}`, detail: `${p.client.companyName} · ${formatDateKey(endKey)}${p.autoRenew ? " · auto-renew on" : " · send renewal offer"}`,
      href: `/projects/${p.id}`, entityType: "Project", entityId: p.id, dateKey: endKey,
    });
  }
  for (const m of milestones) {
    const due = dateOnlyKey(m.dueDate!);
    const missed = due < T;
    alerts.push({
      key: `MILESTONE_DUE:${m.id}:${due}`, type: "MILESTONE_DUE", category: "milestone", severity: missed ? "CRITICAL" : "INFO",
      title: `${m.name} – ${m.project.name}`, detail: missed ? `Missed · was due ${formatDateKey(due)}` : `Due ${formatDateKey(due)}`,
      href: `/projects/${m.project.id}`, entityType: "Milestone", entityId: m.id, dateKey: due,
    });
  }
  const onboardingByProject = new Map<string, { name: string; items: string[] }>();
  for (const o of onboarding) {
    const p = o.checklist.project;
    if (!p) continue;
    const entry = onboardingByProject.get(p.id) ?? { name: p.name, items: [] };
    entry.items.push(o.title);
    onboardingByProject.set(p.id, entry);
  }
  for (const [pid, v] of onboardingByProject) {
    alerts.push({
      key: `ONBOARDING_PENDING:${pid}`, type: "ONBOARDING_PENDING", category: "onboarding", severity: "WARNING",
      title: `${v.name}: ${v.items.length} onboarding item${v.items.length === 1 ? "" : "s"} pending`, detail: v.items.slice(0, 3).join(", "),
      href: `/projects/${pid}`, entityType: "Project", entityId: pid,
    });
  }
  for (const c of comms) {
    const due = dateOnlyKey(c.nextActionDate!);
    alerts.push({
      key: `COMMUNICATION_NEXT_ACTION:${c.id}`, type: "COMMUNICATION_NEXT_ACTION", category: "follow_up", severity: due < T ? "WARNING" : "INFO",
      title: c.nextAction!, detail: `${c.client?.companyName ?? ""} · ${due < T ? `was due ${formatDateKey(due)}` : "due today"}`,
      href: c.clientId ? `/clients/${c.clientId}?tab=communication` : "/clients", entityType: "CommunicationLog", entityId: c.id, dateKey: due,
    });
  }

  // hide snoozed / done
  const states = await db.reminder.findMany({
    where: { dedupeKey: { in: alerts.map((a) => a.key) }, status: { in: ["DONE", "SNOOZED"] } },
    select: { dedupeKey: true, status: true, snoozedUntil: true },
  });
  const hidden = new Set(states.filter((r) => r.status === "DONE" || (r.snoozedUntil && r.snoozedUntil > new Date())).map((r) => r.dedupeKey));
  const visible = alerts.filter((a) => !hidden.has(a.key));
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  visible.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.dateKey ?? "").localeCompare(b.dateKey ?? ""));
  return { alerts: visible, hiddenCount: alerts.length - visible.length };
}
