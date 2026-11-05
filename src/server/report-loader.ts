import "server-only";
import { monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { statementPeriod } from "@/lib/invoice-rules";
import { idParam, param, type SearchParams } from "@/lib/list-params";
import type { ReportDoc } from "@/lib/reports";
import { agencyReportDoc, clientMonthlyDoc, clientReportDoc, gstReportDoc } from "@/server/services/reports";

/** A month from the address. Unless chosen, last month, since it's the one that's finished. */
export function reportMonth(value: string | null | undefined, today = todayKey()) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= monthKeyOf(today) ? value : shiftMonth(monthKeyOf(today), -1);
}

export async function loadReport(kind: string, sp: SearchParams): Promise<ReportDoc | null> {
  const today = todayKey();
  const { from, to } = statementPeriod(param(sp, "from"), param(sp, "to"), today);
  const clientId = idParam(sp, "client");
  switch (kind) {
    case "agency":
      return agencyReportDoc(db, { from, to, today });
    case "gst":
      return gstReportDoc(db, { fy: param(sp, "fy"), today });
    case "client":
      return clientId ? clientReportDoc(db, { clientId, from, to, today }) : null;
    case "monthly":
      return clientId ? clientMonthlyDoc(db, { clientId, month: reportMonth(param(sp, "month"), today) }) : null;
    default:
      return null;
  }
}

export async function agencyLetterhead() {
  const s = await db.settings.findUniqueOrThrow({ where: { id: "agency" }, select: { agencyName: true, email: true, phone: true, website: true, logoKey: true } });
  return { name: s.agencyName, contact: [s.phone, s.email, s.website].filter(Boolean).join(" · "), logoKey: s.logoKey };
}
