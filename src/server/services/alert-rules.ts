import type { Prisma, ReminderType } from "@prisma/client";
import { addDaysKey, dateOnlyKey, daysBetweenKeys, formatDateKey, formatMonthKey, keyToDate, monthRange } from "@/lib/dates";
import { Decimal, formatINR, toDecimal } from "@/lib/money";
import { assetKindLabel } from "@/lib/renewals";
import type { AlertCategory } from "@/lib/alerts";
import type { Db } from "./shared";

export type Alert = {
  key: string; // dedupe key: stable per item, used for snooze and done
  type: ReminderType;
  category: AlertCategory;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  href: string;
  entityType: string;
  entityId: string;
  dateKey?: string;
  /** Who this is for. Empty means the admins. */
  assigneeId?: string | null;
};

export type AlertScope = {
  today: string;
  sectorId?: string;
  clientWhere: Prisma.ClientWhereInput;
  taskWhere: Prisma.TaskWhereInput;
  projectWhere: Prisma.ProjectWhereInput;
};

export const wholeAgency = (today: string): AlertScope => ({ today, clientWhere: { archivedAt: null }, taskWhere: { archivedAt: null }, projectWhere: { archivedAt: null } });

export type AlertSettings = { approvalWaitDays: number; adBudgetAlertPercent: number; retainerEndingDays: number; shortfallDaysLeft: number; renewalAlertDays: number[]; dueSoonDays: number };

/**
 * Every rule from the brief's daily reminders, worked out from the current data. The dashboard and the
 * daily job both use this, so they can't disagree. `limit` keeps the dashboard quick; the job needs them all.
 */
export async function collectAlerts(db: Db, scope: AlertScope, opts: { money: boolean; settings: AlertSettings; includeDueSoon?: boolean; limit?: number }): Promise<Alert[]> {
  const T = scope.today;
  const today = keyToDate(T);
  const s = opts.settings;
  const alerts: Alert[] = [];
  const take = opts.limit ?? 5000;
  const now = new Date();

  const [overdue, dueToday, dueSoon, waiting, approvalLinks, leads, offers, invoices, assets, campaigns, retainers, deadlines, milestones, onboarding, comms] = await Promise.all([
    db.task.findMany({
      where: { ...scope.taskWhere, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take,
      select: { id: true, title: true, dueDate: true, status: true, assigneeId: true, client: { select: { companyName: true } }, assignee: { select: { name: true } } },
    }),
    db.task.findMany({
      where: { ...scope.taskWhere, status: { not: "DONE" }, dueDate: today },
      take,
      select: { id: true, title: true, assigneeId: true, client: { select: { companyName: true } }, assignee: { select: { name: true } } },
    }),
    opts.includeDueSoon
      ? db.task.findMany({
          where: { ...scope.taskWhere, status: { not: "DONE" }, dueDate: { gt: today, lte: keyToDate(addDaysKey(T, s.dueSoonDays)) } },
          take,
          select: { id: true, title: true, dueDate: true, assigneeId: true, client: { select: { companyName: true } }, assignee: { select: { name: true } } },
        })
      : [],
    db.task.findMany({
      where: { ...scope.taskWhere, status: "WAITING_CLIENT_APPROVAL", statusChangedAt: { lte: new Date(now.getTime() - s.approvalWaitDays * 86_400_000) } },
      take,
      select: { id: true, title: true, statusChangedAt: true, assigneeId: true, client: { select: { companyName: true } } },
    }),
    // A calendar sent to a client who hasn't finished answering.
    db.publicLink.findMany({
      where: { type: "CONTENT_APPROVAL", revokedAt: null, expiresAt: { gt: now }, createdAt: { lte: new Date(now.getTime() - s.approvalWaitDays * 86_400_000) } },
      select: { id: true, clientId: true, month: true, createdAt: true },
    }),
    db.lead.findMany({
      where: { archivedAt: null, stage: { notIn: ["WON", "LOST"] }, nextFollowUpDate: { lte: today }, ...(scope.sectorId ? { sectorId: scope.sectorId } : {}) },
      select: { id: true, contactName: true, companyName: true, nextFollowUpDate: true, stage: true },
    }),
    db.offer.findMany({
      where: { archivedAt: null, isTemplate: false, status: { in: ["SENT", "ON_HOLD"] }, OR: [{ followUpDate: { lte: today } }, { validUntil: { lte: keyToDate(addDaysKey(T, 3)) } }] },
      select: { id: true, number: true, title: true, followUpDate: true, validUntil: true, client: { select: { companyName: true } }, lead: { select: { companyName: true } } },
    }),
    opts.money
      ? db.invoice.findMany({
          where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 }, dueDate: { lte: keyToDate(addDaysKey(T, 3)) }, client: scope.clientWhere },
          orderBy: { dueDate: "asc" },
          select: { id: true, number: true, dueDate: true, balanceDue: true, client: { select: { companyName: true } } },
        })
      : [],
    opts.money
      ? db.domainHostingAsset.findMany({
          where: { archivedAt: null, expiryDate: { lte: keyToDate(addDaysKey(T, Math.max(...s.renewalAlertDays, 30))) }, client: scope.clientWhere },
          orderBy: { expiryDate: "asc" },
          select: { id: true, name: true, kind: true, expiryDate: true, client: { select: { companyName: true } } },
        })
      : [],
    db.adCampaign.findMany({
      where: { archivedAt: null, status: "ACTIVE", client: scope.clientWhere },
      select: { id: true, name: true, plannedBudget: true, client: { select: { companyName: true } }, entries: { where: { archivedAt: null }, select: { spend: true } } },
    }),
    db.project.findMany({
      where: { ...scope.projectWhere, status: "ACTIVE", isRetainer: true, retainerEnd: { gte: today, lte: keyToDate(addDaysKey(T, s.retainerEndingDays)) } },
      select: { id: true, name: true, retainerEnd: true, autoRenew: true, client: { select: { companyName: true } } },
    }),
    db.project.findMany({
      where: { ...scope.projectWhere, status: "ACTIVE", deadline: { lte: keyToDate(addDaysKey(T, 7)) } },
      select: { id: true, name: true, deadline: true, managerId: true, client: { select: { companyName: true } } },
    }),
    db.milestone.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: { lte: keyToDate(addDaysKey(T, 7)) }, project: { ...scope.projectWhere, status: "ACTIVE" } },
      select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
    }),
    db.onboardingItem.findMany({
      where: { isDone: false, checklist: { project: { ...scope.projectWhere, status: "ACTIVE", startDate: { lte: keyToDate(addDaysKey(T, -7)) } } } },
      select: { id: true, title: true, checklist: { select: { project: { select: { id: true, name: true } } } } },
    }),
    db.communicationLog.findMany({
      where: { archivedAt: null, nextActionDate: { lte: today, gte: keyToDate(addDaysKey(T, -14)) }, nextAction: { not: null }, client: scope.clientWhere },
      select: { id: true, clientId: true, nextAction: true, nextActionDate: true, client: { select: { companyName: true } } },
    }),
  ]);

  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  for (const t of overdue) {
    const days = daysBetweenKeys(dateOnlyKey(t.dueDate!), T);
    alerts.push({
      key: `TASK_OVERDUE:${t.id}`, type: "TASK_OVERDUE", category: "overdue", severity: days > 3 || t.status === "BLOCKED" ? "CRITICAL" : "WARNING",
      title: t.title, detail: `${t.client?.companyName ?? ""} · ${t.assignee?.name ?? "Unassigned"} · ${plural(days)} overdue${t.status === "BLOCKED" ? " · Blocked" : ""}`,
      href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, dateKey: dateOnlyKey(t.dueDate!), assigneeId: t.assigneeId,
    });
  }
  for (const t of dueToday) {
    alerts.push({
      key: `TASK_DUE_TODAY:${t.id}:${T}`, type: "TASK_DUE_TODAY", category: "due_today", severity: "INFO",
      title: t.title, detail: `${t.client?.companyName ?? ""} · ${t.assignee?.name ?? "Unassigned"}`, href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, dateKey: T, assigneeId: t.assigneeId,
    });
  }
  for (const t of dueSoon) {
    const due = dateOnlyKey(t.dueDate!);
    alerts.push({
      key: `TASK_DUE_SOON:${t.id}:${due}`, type: "TASK_DUE_SOON", category: "due_soon", severity: "INFO",
      title: t.title, detail: `${t.client?.companyName ?? ""} · ${t.assignee?.name ?? "Unassigned"} · due ${formatDateKey(due)}`, href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, dateKey: due, assigneeId: t.assigneeId,
    });
  }
  for (const t of waiting) {
    const days = Math.floor((now.getTime() - t.statusChangedAt.getTime()) / 86_400_000);
    alerts.push({
      key: `WAITING_APPROVAL:${t.id}`, type: "WAITING_APPROVAL", category: "approval", severity: days >= 5 ? "CRITICAL" : "WARNING",
      title: t.title, detail: `${t.client?.companyName ?? ""} · waiting ${days} days for client approval`, href: `/tasks/${t.id}`, entityType: "Task", entityId: t.id, assigneeId: t.assigneeId,
    });
  }
  if (approvalLinks.length) {
    const clients = await db.client.findMany({ where: { ...scope.clientWhere, id: { in: approvalLinks.map((l) => l.clientId!) } }, select: { id: true, companyName: true } });
    for (const l of approvalLinks) {
      const client = clients.find((c) => c.id === l.clientId);
      if (!client) continue;
      const pending = await db.contentCalendarItem.count({ where: { clientId: l.clientId!, month: l.month!, archivedAt: null, approvalStatus: "PENDING", publishedAt: null } });
      if (!pending) continue;
      const days = Math.floor((now.getTime() - l.createdAt.getTime()) / 86_400_000);
      alerts.push({
        key: `WAITING_APPROVAL:content:${l.id}`, type: "WAITING_APPROVAL", category: "approval", severity: days >= 5 ? "CRITICAL" : "WARNING",
        title: `${client.companyName}: ${pending} content item${pending === 1 ? "" : "s"} awaiting approval`, detail: `${formatMonthKey(l.month!)} · sent ${days} days ago`,
        href: `/content?client=${l.clientId}&month=${l.month}`, entityType: "PublicLink", entityId: l.id,
      });
    }
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
        title: `Offer ${o.number} ${days < 0 ? "has expired" : days === 0 ? "expires today" : `expires in ${plural(days)}`}`,
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
    // A bucket in the key, so snoozing at 30 days alerts again at 15, 7 and 1.
    const threshold = [...s.renewalAlertDays].sort((x, y) => x - y).find((d) => days <= d) ?? 0;
    alerts.push({
      key: `RENEWAL_DUE:${a.id}:${exp}:${days < 0 ? "expired" : threshold}`, type: "RENEWAL_DUE", category: "renewal",
      severity: days <= 7 ? "CRITICAL" : days <= 15 ? "WARNING" : "INFO",
      title: `${assetKindLabel(a.kind)} ${days < 0 ? "expired" : days === 0 ? "expires today" : `expires in ${plural(days)}`}: ${a.name}`,
      detail: `${a.client.companyName} · ${formatDateKey(exp)}`, href: `/renewals/${a.id}`, entityType: "DomainHostingAsset", entityId: a.id, dateKey: exp,
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
        href: `/ads/${c.id}`, entityType: "AdCampaign", entityId: c.id,
      });
    }
  }
  // Retainer delivery shortfall, only in the last few days of the month.
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
        title: `${p?.name}: ${r._count.deliveredAt}/${r._count._all} delivered`, detail: `${plural(daysLeft)} left this month`,
        href: `/projects/${r.projectId}`, entityType: "Project", entityId: r.projectId,
      });
    }
  }
  for (const p of retainers) {
    const endKey = dateOnlyKey(p.retainerEnd!);
    const days = daysBetweenKeys(T, endKey);
    alerts.push({
      key: `RETAINER_ENDING:${p.id}:${endKey}`, type: "RETAINER_ENDING", category: "retainer", severity: days <= 7 ? "WARNING" : "INFO",
      title: `${p.name} ends in ${plural(days)}`, detail: `${p.client.companyName} · ${formatDateKey(endKey)}${p.autoRenew ? " · auto-renew on" : " · send renewal offer"}`,
      href: `/projects/${p.id}`, entityType: "Project", entityId: p.id, dateKey: endKey,
    });
  }
  for (const p of deadlines) {
    const due = dateOnlyKey(p.deadline!);
    const days = daysBetweenKeys(T, due);
    alerts.push({
      key: `PROJECT_DEADLINE:${p.id}:${due}`, type: "PROJECT_DEADLINE", category: "deadline", severity: days < 0 ? "CRITICAL" : days <= 3 ? "WARNING" : "INFO",
      title: `${p.name}: ${days < 0 ? `deadline passed ${plural(-days)} ago` : days === 0 ? "deadline today" : `deadline in ${plural(days)}`}`, detail: `${p.client.companyName} · ${formatDateKey(due)}`,
      href: `/projects/${p.id}`, entityType: "Project", entityId: p.id, dateKey: due,
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
      href: `/projects/${pid}?tab=onboarding`, entityType: "Project", entityId: pid,
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
  return alerts;
}
