import { BusinessError, logActivity, type Db, type Tx } from "./shared";

/**
 * Creates the onboarding checklist for an accepted offer: the items for every client, plus those
 * for the services on the offer. Does nothing if the checklist exists, or if the offer is still
 * for a lead (it's created when that lead becomes a client).
 */
export async function ensureOfferOnboarding(tx: Tx, offerId: string) {
  const offer = await tx.offer.findUnique({ where: { id: offerId }, include: { items: { select: { serviceId: true } }, onboarding: true, project: { select: { id: true, onboarding: { select: { id: true } } } } } });
  if (!offer || offer.isTemplate || offer.status !== "ACCEPTED" || !offer.clientId) return null;
  if (offer.onboarding) return offer.onboarding;
  // Older projects may already have one of their own.
  if (offer.project?.onboarding) return offer.project.onboarding;
  const serviceIds = offer.items.map((i) => i.serviceId).filter((s): s is string => !!s);
  const templates = await tx.onboardingTemplateItem.findMany({
    where: { isActive: true, OR: [{ serviceId: null }, { serviceId: { in: serviceIds } }] },
    orderBy: { sortOrder: "asc" },
  });
  const titles = Array.from(new Set(templates.map((t) => t.title)));
  return tx.onboardingChecklist.create({
    data: {
      clientId: offer.clientId,
      offerId: offer.id,
      projectId: offer.project?.id,
      items: { create: titles.map((title, sortOrder) => ({ title, sortOrder })) },
    },
  });
}

async function assertItem(tx: Tx, itemId: string) {
  const item = await tx.onboardingItem.findUnique({ where: { id: itemId }, include: { checklist: true } });
  if (!item) throw new BusinessError("This item no longer exists.");
  return item;
}

export async function setOnboardingItemDone(db: Db, itemId: string, done: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const item = await assertItem(tx, itemId);
    await tx.onboardingItem.update({ where: { id: itemId }, data: { isDone: done, doneAt: done ? new Date() : null, doneById: done ? actorId : null } });
    await logActivity(tx, {
      actorId, action: done ? "onboarding.done" : "onboarding.reopened", entityType: "OnboardingItem", entityId: itemId, clientId: item.checklist.clientId, changes: { title: item.title },
    });
  });
}

export async function addOnboardingItem(db: Db, checklistId: string, title: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const checklist = await tx.onboardingChecklist.findUnique({ where: { id: checklistId } });
    if (!checklist) throw new BusinessError("This checklist no longer exists.");
    const count = await tx.onboardingItem.count({ where: { checklistId } });
    const item = await tx.onboardingItem.create({ data: { checklistId, title, sortOrder: count + 100 } });
    await logActivity(tx, { actorId, action: "onboarding.item_added", entityType: "OnboardingItem", entityId: item.id, clientId: checklist.clientId, changes: { title } });
  });
}

/** Items that were ticked stay as a record of what was done. */
export async function removeOnboardingItem(db: Db, itemId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const item = await assertItem(tx, itemId);
    if (item.isDone) throw new BusinessError("This item is already done, so it stays on the record. Untick it first.");
    await tx.onboardingItem.delete({ where: { id: itemId } });
    await logActivity(tx, { actorId, action: "onboarding.item_removed", entityType: "OnboardingItem", entityId: itemId, clientId: item.checklist.clientId, changes: { title: item.title } });
  });
}

/**
 * Replaces the standard checklist for a service, or for all clients when serviceId is null.
 * Existing clients' checklists aren't changed.
 */
export async function saveOnboardingTemplate(db: Db, serviceId: string | null, titles: string[], actorId: string) {
  await db.$transaction(async (tx) => {
    const existing = await tx.onboardingTemplateItem.findMany({ where: { serviceId } });
    for (const [sortOrder, title] of titles.entries()) {
      const match = existing.find((e) => e.title === title);
      if (match) await tx.onboardingTemplateItem.update({ where: { id: match.id }, data: { isActive: true, sortOrder } });
      else await tx.onboardingTemplateItem.create({ data: { serviceId, title, sortOrder } });
    }
    await tx.onboardingTemplateItem.updateMany({ where: { serviceId, title: { notIn: titles } }, data: { isActive: false } });
    await logActivity(tx, { actorId, action: "onboarding.template_saved", entityType: "OnboardingTemplate", entityId: serviceId ?? "all", changes: { items: titles.length } });
  });
}
