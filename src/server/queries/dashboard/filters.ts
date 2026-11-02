import type { Prisma } from "@prisma/client";
import { addMonths } from "date-fns";
import { db } from "@/lib/db";
import { dateOnlyKey, financialYear, keyToDate, monthRange, todayKey } from "@/lib/dates";

export const PRESETS = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_fy: "This financial year",
  last_12_months: "Last 12 months",
  custom: "Custom range",
} as const;
export type Preset = keyof typeof PRESETS;

export interface Filters {
  preset: Preset;
  from: string; // date key, inclusive
  to: string; // date key, inclusive
  prevFrom: string;
  prevTo: string;
  compareLabel: string;
  sectorId?: string;
  serviceId?: string;
  departmentId?: string;
  employeeId?: string;
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]{10,40}$/i;

function shiftKeyMonths(key: string, n: number): string {
  // clamp to month end (e.g. 31 Mar − 1 month → 28/29 Feb)
  return dateOnlyKey(addMonths(keyToDate(key), n));
}

function daysBetween(a: string, b: string) {
  return Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / 86_400_000);
}

/** Parse & validate dashboard filters from the URL. Never trusts input. */
export function parseFilters(sp: Record<string, string | string[] | undefined>, today = todayKey()): Filters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const preset = (Object.keys(PRESETS) as Preset[]).includes(get("range") as Preset) ? (get("range") as Preset) : "this_month";

  let from: string;
  let to: string;
  switch (preset) {
    case "last_month": {
      const r = monthRange(shiftKeyMonths(`${today.slice(0, 7)}-01`, -1));
      from = r.start;
      to = r.end;
      break;
    }
    case "this_quarter": {
      const [y, m] = today.split("-").map(Number);
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      from = `${y}-${String(qStart).padStart(2, "0")}-01`;
      to = today;
      break;
    }
    case "this_fy": {
      from = `${financialYear(today).slice(0, 4)}-04-01`;
      to = today;
      break;
    }
    case "last_12_months":
      from = `${shiftKeyMonths(`${today.slice(0, 7)}-01`, -11)}`;
      to = today;
      break;
    case "custom": {
      const f = get("from");
      const t = get("to");
      from = f && KEY.test(f) ? f : `${today.slice(0, 7)}-01`;
      to = t && KEY.test(t) ? t : today;
      if (from > to) [from, to] = [to, from];
      break;
    }
    default:
      from = `${today.slice(0, 7)}-01`;
      to = today;
  }

  // Comparison period: month-aligned ranges compare with the same days one month
  // earlier ("vs last month"); others with the immediately preceding period.
  let prevFrom: string;
  let prevTo: string;
  let compareLabel: string;
  if ((preset === "this_month" || preset === "last_month") && from.endsWith("-01")) {
    prevFrom = shiftKeyMonths(from, -1);
    prevTo = shiftKeyMonths(to, -1);
    compareLabel = "vs last month";
  } else {
    const len = daysBetween(from, to) + 1;
    prevTo = dateOnlyKey(new Date(keyToDate(from).getTime() - 86_400_000));
    prevFrom = dateOnlyKey(new Date(keyToDate(prevTo).getTime() - (len - 1) * 86_400_000));
    compareLabel = "vs previous period";
  }

  const id = (k: string) => {
    const v = get(k);
    return v && ID.test(v) ? v : undefined;
  };
  return {
    preset,
    from,
    to,
    prevFrom,
    prevTo,
    compareLabel,
    sectorId: id("sector"),
    serviceId: id("service"),
    departmentId: id("dept"),
    employeeId: id("emp"),
  };
}

export interface Scope {
  f: Filters;
  today: string;
  /** Clients matching sector / employee filters */
  clientWhere: Prisma.ClientWhereInput;
  /** null = all services; otherwise restrict money & projects to these services */
  serviceIds: string[] | null;
  taskWhere: Prisma.TaskWhereInput;
  projectWhere: Prisma.ProjectWhereInput;
}

export async function buildScope(f: Filters, today = todayKey()): Promise<Scope> {
  let serviceIds: string[] | null = null;
  if (f.serviceId || f.departmentId) {
    const services = await db.service.findMany({
      where: { ...(f.serviceId ? { id: f.serviceId } : {}), ...(f.departmentId ? { departmentId: f.departmentId } : {}) },
      select: { id: true },
    });
    serviceIds = services.map((s) => s.id);
  }

  const clientWhere: Prisma.ClientWhereInput = {
    archivedAt: null,
    ...(f.sectorId ? { sectorId: f.sectorId } : {}),
    ...(f.employeeId
      ? {
          OR: [
            { accountManagerId: f.employeeId },
            { projects: { some: { managerId: f.employeeId } } },
            { tasks: { some: { assigneeId: f.employeeId, archivedAt: null } } },
          ],
        }
      : {}),
  };

  const taskWhere: Prisma.TaskWhereInput = {
    archivedAt: null,
    ...(f.sectorId ? { client: { sectorId: f.sectorId } } : {}),
    ...(f.serviceId ? { serviceId: f.serviceId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.employeeId ? { assigneeId: f.employeeId } : {}),
  };

  const projectWhere: Prisma.ProjectWhereInput = {
    archivedAt: null,
    ...(f.sectorId ? { client: { sectorId: f.sectorId } } : {}),
    ...(serviceIds ? { services: { some: { serviceId: { in: serviceIds } } } } : {}),
    ...(f.employeeId
      ? { OR: [{ managerId: f.employeeId }, { tasks: { some: { assigneeId: f.employeeId, archivedAt: null } } }] }
      : {}),
  };

  return { f, today, clientWhere, serviceIds, taskWhere, projectWhere };
}

export async function getFilterOptions() {
  const [sectors, services, departments, employees] = await Promise.all([
    db.sector.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.service.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true, role: { not: "ADMIN" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { sectors, services, departments, employees };
}

/** Prisma range filter for a @db.Date column. */
export function dateRange(from: string, to: string) {
  return { gte: keyToDate(from), lte: keyToDate(to) };
}

/** Prisma range filter for a timestamp column, using IST day boundaries. */
export function instantRange(from: string, to: string) {
  const start = new Date(keyToDate(from).getTime() - 330 * 60_000);
  const end = new Date(keyToDate(to).getTime() + (24 * 60 - 330) * 60_000 - 1);
  return { gte: start, lte: end };
}
