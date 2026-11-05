import "server-only";
import { db } from "@/lib/db";
import { collectAlerts, type Alert, type AlertSettings } from "@/server/services/alert-rules";
import type { Scope } from "./filters";

export { ALERT_CATEGORIES, type AlertCategory } from "@/lib/alerts";
export type { Alert };

/** The dashboard's alerts, worked out live so filters apply, leaving out anything snoozed or done. */
export async function getAlerts(scope: Scope, opts: { money: boolean; settings: AlertSettings }) {
  const alerts = await collectAlerts(
    db,
    { today: scope.today, sectorId: scope.f.sectorId, clientWhere: scope.clientWhere, taskWhere: scope.taskWhere, projectWhere: scope.projectWhere },
    { money: opts.money, settings: opts.settings, limit: 100 },
  );
  const states = await db.reminder.findMany({
    where: { dedupeKey: { in: alerts.map((a) => a.key) }, status: { in: ["DONE", "SNOOZED"] } },
    select: { dedupeKey: true, status: true, snoozedUntil: true, doneManually: true },
  });
  const hidden = new Set(states.filter((r) => (r.status === "DONE" && r.doneManually) || (r.status === "SNOOZED" && r.snoozedUntil && r.snoozedUntil > new Date())).map((r) => r.dedupeKey));
  const visible = alerts.filter((a) => !hidden.has(a.key));
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  visible.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.dateKey ?? "").localeCompare(b.dateKey ?? ""));
  return { alerts: visible, hiddenCount: alerts.length - visible.length };
}
