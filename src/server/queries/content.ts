import "server-only";
import type { ApprovalStatus, ContentFormat, DesignStatus, Prisma } from "@prisma/client";
import { APPROVAL_STATUSES, CONTENT_FORMATS, DESIGN_STATUSES, summariseDelivery } from "@/lib/content-plan";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { contentScope } from "@/server/services/content";
import type { Viewer } from "@/server/services/tasks";
import { projectScope } from "./projects";

const SORTS = ["publishDate", "topic", "approvalStatus", "designStatus"] as const;
const LIST = { sorts: SORTS, defaultSort: "publishDate", defaultDir: "asc" } as const;

export function buildContentWhere(sp: SearchParams, viewer: Viewer, q: string): Prisma.ContentCalendarItemWhereInput {
  const format = CONTENT_FORMATS.find((f) => f === param(sp, "format")) as ContentFormat | undefined;
  const approval = APPROVAL_STATUSES.find((s) => s === param(sp, "approval")) as ApprovalStatus | undefined;
  const design = DESIGN_STATUSES.find((s) => s === param(sp, "design")) as DesignStatus | undefined;
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    AND: [
      contentScope(viewer),
      { archivedAt: param(sp, "show") === "archived" ? { not: null } : null },
      idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {},
      format ? { format } : {},
      approval ? { approvalStatus: approval } : {},
      design ? { designStatus: design } : {},
      q ? { OR: [{ topic: contains }, { caption: contains }, { client: { companyName: contains } }] } : {},
    ],
  };
}

const select = {
  id: true, topic: true, format: true, platforms: true, designStatus: true, approvalStatus: true, publishDate: true, publishedAt: true, publishedLink: true, month: true,
  client: { select: { id: true, companyName: true } },
} satisfies Prisma.ContentCalendarItemSelect;

function toRow(c: Prisma.ContentCalendarItemGetPayload<{ select: typeof select }>) {
  return {
    id: c.id,
    topic: c.topic,
    format: c.format as string,
    platforms: c.platforms as string[],
    designStatus: c.designStatus as string,
    approvalStatus: c.approvalStatus as string,
    publishDate: c.publishDate ? dateOnlyKey(c.publishDate) : null,
    published: !!c.publishedAt,
    publishedLink: c.publishedLink,
    client: c.client.companyName,
  };
}
export type ContentRow = ReturnType<typeof toRow>;

/** Everything in one month, for the calendar. */
export async function getContentCalendar(sp: SearchParams, viewer: Viewer, month: string) {
  const params = parseListParams(sp, LIST);
  const rows = await db.contentCalendarItem.findMany({
    where: { AND: [buildContentWhere(sp, viewer, params.q), { month }] },
    select,
    orderBy: [{ publishDate: "asc" }, { id: "asc" }],
    take: 600,
  });
  return rows.map(toRow);
}

export async function getContentList(sp: SearchParams, viewer: Viewer, month: string | null) {
  const params = parseListParams(sp, LIST);
  const where: Prisma.ContentCalendarItemWhereInput = { AND: [buildContentWhere(sp, viewer, params.q), month ? { month } : {}] };
  const total = await db.contentCalendarItem.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.contentCalendarItem.findMany({ where, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getContentForExport(sp: SearchParams, viewer: Viewer, month: string | null) {
  const params = parseListParams(sp, LIST);
  const rows = await db.contentCalendarItem.findMany({ where: { AND: [buildContentWhere(sp, viewer, params.q), month ? { month } : {}] }, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return rows.map(toRow);
}

/** Committed vs delivered comes from the retainer's deliverables, the same figures as the dashboard and project page. */
export async function getDeliverySummary(month: string, viewer: Viewer, clientId: string | null) {
  const rows = await db.deliverable.findMany({
    where: {
      month,
      format: { not: null },
      project: { archivedAt: null, status: { not: "CANCELLED" }, ...projectScope(viewer), ...(clientId ? { clientId } : {}) },
    },
    select: { format: true, deliveredAt: true, project: { select: { client: { select: { id: true, companyName: true } } } } },
    take: 5000,
  });
  return summariseDelivery(rows.map((r) => ({ clientId: r.project.client.id, client: r.project.client.companyName, format: r.format, delivered: !!r.deliveredAt })));
}

export function getContentClients(viewer: Viewer) {
  return db.client.findMany({
    where: { archivedAt: null, ...(viewer.role === "EMPLOYEE" ? { projects: { some: projectScope(viewer) } } : {}) },
    orderBy: { companyName: "asc" },
    select: { id: true, companyName: true },
  });
}

export async function getContentFormOptions(including?: { clientId?: string; projectId?: string | null }) {
  const [clients, projects] = await Promise.all([
    db.client.findMany({ where: { OR: [{ archivedAt: null }, ...(including?.clientId ? [{ id: including.clientId }] : [])] }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    db.project.findMany({ where: { OR: [{ archivedAt: null }, ...(including?.projectId ? [{ id: including.projectId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
  ]);
  return {
    clients: clients.map((c) => ({ value: c.id, label: c.companyName })),
    projects: projects.map((p) => ({ value: p.id, label: p.name, clientId: p.clientId })),
  };
}

export async function getContentItem(id: string, viewer: Viewer) {
  const item = await db.contentCalendarItem.findFirst({
    where: { id, ...contentScope(viewer) },
    include: {
      client: { select: { id: true, companyName: true } },
      project: { select: { id: true, name: true } },
      deliverable: { select: { id: true, title: true, revisionsUsed: true, revisionsIncluded: true, deliveredAt: true, _count: { select: { tasks: true } } } },
      approvals: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!item) return null;
  const creative = item.creativeDocId ? await db.document.findFirst({ where: { id: item.creativeDocId, archivedAt: null }, select: { id: true, name: true, mimeType: true } }) : null;
  return { ...item, creative };
}

export const getCurrentContentLink = (clientId: string, month: string) =>
  db.publicLink.findFirst({
    where: { type: "CONTENT_APPROVAL", clientId, month, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiresAt: true, viewCount: true, lastViewedAt: true },
  });
