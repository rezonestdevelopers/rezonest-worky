import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { keyToDate, monthKeyOf } from "@/lib/dates";
import { approvalNeedsReset, CONTENT_LINK_DAYS, contentLinkError, contentResponseError } from "@/lib/content-plan";
import { hashPublicToken, looksLikeToken, publicToken } from "@/lib/public-token";
import type { ContentItemData } from "@/lib/validators/delivery";
import { revisionsExceeded } from "@/lib/work-plan";
import { BusinessError, logActivity, type Db, type Tx } from "./shared";
import { applyClientDecision, completeDeliverableTasks, taskScope, type Viewer } from "./tasks";

/** Employees see content for projects where they can see a task. Everyone else sees it all. */
export function contentScope(viewer: Viewer): Prisma.ContentCalendarItemWhereInput {
  return viewer.role === "EMPLOYEE" ? { project: { tasks: { some: { archivedAt: null, ...taskScope(viewer) } } } } : {};
}

async function visibleItem(tx: Db | Tx, itemId: string, viewer: Viewer) {
  const item = await tx.contentCalendarItem.findFirst({ where: { id: itemId, archivedAt: null, ...contentScope(viewer) } });
  if (!item) throw new BusinessError("This content item isn't available.");
  return item;
}

async function assertClientAndProject(tx: Tx, clientId: string, projectId: string | null) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client || client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");
  if (projectId) {
    const project = await tx.project.findFirst({ where: { id: projectId, clientId, archivedAt: null } });
    if (!project) throw new BusinessError("That project isn't one of this client's.");
  }
}

const resetApproval = { approvalStatus: "PENDING" as const };

export async function saveContentItem(db: Db, id: string | null, data: ContentItemData, actorId: string) {
  return db.$transaction(async (tx) => {
    await assertClientAndProject(tx, data.clientId, data.projectId);
    const fields = {
      clientId: data.clientId,
      projectId: data.projectId,
      format: data.format,
      platforms: data.platforms,
      topic: data.topic,
      caption: data.caption,
      publishDate: keyToDate(data.publishDate),
      month: monthKeyOf(data.publishDate),
    };
    if (!id) {
      const item = await tx.contentCalendarItem.create({ data: fields });
      await logActivity(tx, { actorId, action: "content.created", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { topic: item.topic, month: item.month } });
      return { item, approvalReset: false };
    }
    const before = await tx.contentCalendarItem.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This content item no longer exists.");
    if (before.publishedAt) throw new BusinessError("This has been published, so it can't be edited. Undo that first.");
    // Approved words can't change without the client seeing them again.
    const approvalReset = before.approvalStatus === "APPROVED" && approvalNeedsReset(before, { topic: data.topic, caption: data.caption, creativeUrl: before.creativeUrl });
    const item = await tx.contentCalendarItem.update({ where: { id }, data: { ...fields, ...(approvalReset ? resetApproval : {}) } });
    await logActivity(tx, {
      actorId, action: "content.updated", entityType: "ContentCalendarItem", entityId: id, clientId: item.clientId,
      changes: { topic: item.topic, ...(before.month !== item.month ? { month: { from: before.month, to: item.month } } : {}), ...(approvalReset ? { approval: { from: "APPROVED", to: "PENDING" } } : {}) },
    });
    return { item, approvalReset };
  });
}

export async function setDesignStatus(db: Db, input: { itemId: string; designStatus: "NOT_STARTED" | "IN_PROGRESS" | "READY"; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const item = await visibleItem(tx, input.itemId, input.viewer);
    await tx.contentCalendarItem.update({ where: { id: item.id }, data: { designStatus: input.designStatus } });
    await logActivity(tx, { actorId: input.viewer.id, action: "content.design_status", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { design: { from: item.designStatus, to: input.designStatus } } });
  });
}

/** A new creative replaces the old one, which is kept but archived. An approved item goes back for approval. */
export async function setCreativeFile(db: Db, input: { itemId: string; name: string; storageKey: string; mimeType: string; sizeBytes: number; viewer: Viewer }) {
  return db.$transaction(async (tx) => {
    const item = await visibleItem(tx, input.itemId, input.viewer);
    if (item.publishedAt) throw new BusinessError("This has been published, so its creative can't change.");
    const doc = await tx.document.create({
      data: { name: input.name, category: "CREATIVE", storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes, clientId: item.clientId, projectId: item.projectId, uploadedById: input.viewer.id },
    });
    if (item.creativeDocId) await tx.document.updateMany({ where: { id: item.creativeDocId }, data: { archivedAt: new Date() } });
    const approvalReset = item.approvalStatus === "APPROVED";
    await tx.contentCalendarItem.update({ where: { id: item.id }, data: { creativeDocId: doc.id, ...(approvalReset ? resetApproval : {}) } });
    await logActivity(tx, { actorId: input.viewer.id, action: "content.creative_added", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { file: input.name, ...(approvalReset ? { approval: { from: "APPROVED", to: "PENDING" } } : {}) } });
    return { approvalReset };
  });
}

export async function setCreativeLink(db: Db, input: { itemId: string; creativeUrl: string | null; viewer: Viewer }) {
  return db.$transaction(async (tx) => {
    const item = await visibleItem(tx, input.itemId, input.viewer);
    if (item.publishedAt) throw new BusinessError("This has been published, so its creative can't change.");
    const changed = (item.creativeUrl ?? "") !== (input.creativeUrl ?? "");
    const approvalReset = changed && item.approvalStatus === "APPROVED";
    await tx.contentCalendarItem.update({ where: { id: item.id }, data: { creativeUrl: input.creativeUrl, ...(approvalReset ? resetApproval : {}) } });
    if (changed) await logActivity(tx, { actorId: input.viewer.id, action: "content.creative_link", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { link: { from: item.creativeUrl, to: input.creativeUrl } } });
    return { approvalReset };
  });
}

/** You've made the client's changes: it goes back for them to look at. */
export async function reopenForApproval(db: Db, itemId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.contentCalendarItem.updateMany({ where: { id: itemId, approvalStatus: "CHANGES_REQUESTED", archivedAt: null }, data: resetApproval });
    if (!count) throw new BusinessError("This item isn't waiting on changes.");
    const item = await tx.contentCalendarItem.findUniqueOrThrow({ where: { id: itemId } });
    await logActivity(tx, { actorId, action: "content.reopened", entityType: "ContentCalendarItem", entityId: itemId, clientId: item.clientId, changes: { approval: { from: "CHANGES_REQUESTED", to: "PENDING" } } });
  });
}

/** For approvals that came by phone or WhatsApp. The history says who recorded it, and how it came. */
export async function approveByHand(db: Db, input: { itemId: string; comment: string; actorId: string; actorName: string }) {
  await db.$transaction(async (tx) => {
    const item = await tx.contentCalendarItem.findUnique({ where: { id: input.itemId } });
    if (!item || item.archivedAt) throw new BusinessError("This content item no longer exists.");
    if (item.publishedAt) throw new BusinessError("This has already been published.");
    if (item.approvalStatus === "APPROVED") throw new BusinessError("This has already been approved.");
    await tx.contentCalendarItem.update({ where: { id: item.id }, data: { approvalStatus: "APPROVED" } });
    await tx.contentApproval.create({ data: { itemId: item.id, decision: "APPROVED", comment: input.comment, byName: `Recorded by ${input.actorName}` } });
    if (item.deliverableId) await applyClientDecision(tx, item.deliverableId, true, input.actorId);
    await logActivity(tx, { actorId: input.actorId, action: "content.approved_by_hand", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { approval: { from: item.approvalStatus, to: "APPROVED" }, note: input.comment } });
  });
}

/** Only approved content can be published. Publishing delivers it, so its open tasks finish too. */
export async function markPublished(db: Db, input: { itemId: string; publishedLink: string | null; viewer: Viewer }) {
  return db.$transaction(async (tx) => {
    const item = await visibleItem(tx, input.itemId, input.viewer);
    if (item.publishedAt) throw new BusinessError("This has already been marked as published.");
    if (item.approvalStatus !== "APPROVED") throw new BusinessError("The client hasn't approved this yet.");
    const { count } = await tx.contentCalendarItem.updateMany({ where: { id: item.id, publishedAt: null }, data: { publishedAt: new Date(), publishedLink: input.publishedLink, designStatus: "READY" } });
    if (!count) throw new BusinessError("This has already been marked as published.");
    const closed = item.deliverableId ? await completeDeliverableTasks(tx, item.deliverableId, input.viewer.id) : 0;
    await logActivity(tx, { actorId: input.viewer.id, action: "content.published", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { link: input.publishedLink, tasksClosed: closed } });
    return { closed };
  });
}

export async function undoPublished(db: Db, itemId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const item = await tx.contentCalendarItem.findUnique({ where: { id: itemId } });
    if (!item?.publishedAt) throw new BusinessError("This isn't marked as published.");
    await tx.contentCalendarItem.update({ where: { id: itemId }, data: { publishedAt: null, publishedLink: null } });
    await logActivity(tx, { actorId, action: "content.unpublished", entityType: "ContentCalendarItem", entityId: itemId, clientId: item.clientId, changes: { link: item.publishedLink } });
  });
}

export async function setContentArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const item = await tx.contentCalendarItem.findUnique({ where: { id } });
    if (!item) throw new BusinessError("This content item no longer exists.");
    if (archived && item.deliverableId) throw new BusinessError("This is one of the deliverables you promised this month, so it can't be archived. Edit it instead.");
    await tx.contentCalendarItem.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "content.archived" : "content.restored", entityType: "ContentCalendarItem", entityId: id, clientId: item.clientId, changes: { topic: item.topic } });
  });
}

// ─── The client's approval link ──────────────────────────────────────────────

/** One working link per client and month, so sharing it again doesn't leave several around. */
export async function ensureContentLink(db: Db | Tx, input: { clientId: string; month: string; actorId: string }) {
  const existing = await db.publicLink.findFirst({
    where: { type: "CONTENT_APPROVAL", clientId: input.clientId, month: input.month, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  const items = await db.contentCalendarItem.count({ where: { clientId: input.clientId, month: input.month, archivedAt: null } });
  if (!items) throw new BusinessError("There's no content planned for this client this month.");
  const id = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + CONTENT_LINK_DAYS * 86_400_000);
  const link = await db.publicLink.create({
    data: { id, type: "CONTENT_APPROVAL", tokenHash: hashPublicToken(publicToken(id)), clientId: input.clientId, month: input.month, expiresAt, createdById: input.actorId },
  });
  await logActivity(db, { actorId: input.actorId, action: "content.link_created", entityType: "PublicLink", entityId: link.id, clientId: input.clientId, changes: { month: input.month } });
  return link;
}

export async function revokeContentLink(db: Db, linkId: string, actorId: string) {
  const { count } = await db.publicLink.updateMany({ where: { id: linkId, type: "CONTENT_APPROVAL", revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw new BusinessError("This link has already been withdrawn.");
  const link = await db.publicLink.findUniqueOrThrow({ where: { id: linkId } });
  await logActivity(db, { actorId, action: "content.link_revoked", entityType: "PublicLink", entityId: linkId, clientId: link.clientId, changes: { month: link.month } });
}

export async function findContentLink(db: Db | Tx, token: string) {
  if (!looksLikeToken(token)) return null;
  const link = await db.publicLink.findUnique({ where: { tokenHash: hashPublicToken(token) } });
  return link?.type === "CONTENT_APPROVAL" && link.clientId && link.month ? link : null;
}

/**
 * The client approves, or asks for changes on, one item. What they can touch comes only from the
 * token: this client, this month, and only items still awaiting them.
 */
export async function respondToContent(db: Db, input: { token: string; itemId: string; decision: "APPROVED" | "CHANGES_REQUESTED"; name: string; comment: string | null; ip: string }) {
  return db.$transaction(async (tx) => {
    const link = await findContentLink(tx, input.token);
    if (!link) throw new BusinessError("This link is not valid. Please ask us for a new one.");
    const problem = contentLinkError(link);
    if (problem) throw new BusinessError(problem);
    const item = await tx.contentCalendarItem.findFirst({ where: { id: input.itemId, clientId: link.clientId!, month: link.month! }, include: { project: { select: { managerId: true } }, client: { select: { companyName: true } } } });
    if (!item) throw new BusinessError("This item isn't part of this calendar.");
    const blocked = contentResponseError(item);
    if (blocked) throw new BusinessError(blocked);

    // Two answers at once: only the first one lands.
    const { count } = await tx.contentCalendarItem.updateMany({ where: { id: item.id, approvalStatus: "PENDING" }, data: { approvalStatus: input.decision } });
    if (!count) throw new BusinessError("This has just been answered. Please reload the page.");
    await tx.contentApproval.create({ data: { itemId: item.id, publicLinkId: link.id, decision: input.decision, comment: input.comment, byName: input.name, ip: input.ip } });

    let overRevisions = false;
    if (item.deliverableId) {
      await applyClientDecision(tx, item.deliverableId, input.decision === "APPROVED", null);
      if (input.decision === "CHANGES_REQUESTED") {
        const d = await tx.deliverable.update({ where: { id: item.deliverableId }, data: { revisionsUsed: { increment: 1 } } });
        overRevisions = revisionsExceeded(d.revisionsUsed, d.revisionsIncluded);
      }
    }
    await logActivity(tx, { actorId: null, action: input.decision === "APPROVED" ? "content.client_approved" : "content.client_changes", entityType: "ContentCalendarItem", entityId: item.id, clientId: item.clientId, changes: { by: input.name, ip: input.ip, ...(input.comment ? { comment: input.comment } : {}) } });

    const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    const people = Array.from(new Set([...admins.map((a) => a.id), ...(item.project?.managerId ? [item.project.managerId] : [])]));
    const approved = input.decision === "APPROVED";
    await tx.notification.createMany({
      data: people.map((userId) => ({
        userId,
        title: approved ? `${item.client.companyName} approved content` : `${item.client.companyName} asked for changes`,
        body: `${item.topic}${input.comment ? `: ${input.comment.slice(0, 160)}` : ""}${overRevisions ? " (past the included revisions, so consider a change request)" : ""}`,
        href: `/content/${item.id}`,
      })),
    });
    return { overRevisions };
  });
}
