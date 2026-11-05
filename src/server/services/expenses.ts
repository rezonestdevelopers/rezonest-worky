import { dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import { isFinanceDocument } from "@/lib/file-types";
import type { CommunicationData, ExpenseData } from "@/lib/validators/expense";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

/** A project decides the client. A client and project that don't match are refused. */
async function resolveLink(tx: Tx, clientId: string | null, projectId: string | null) {
  if (projectId) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { clientId: true } });
    if (!project) throw new BusinessError("That project no longer exists.");
    if (clientId && clientId !== project.clientId) throw new BusinessError("That project belongs to a different client.");
    return { clientId: project.clientId, projectId };
  }
  if (clientId && !(await tx.client.count({ where: { id: clientId } }))) throw new BusinessError("That client no longer exists.");
  return { clientId, projectId: null };
}

export async function saveExpense(db: Db, id: string | null, data: ExpenseData, actorId: string, today = todayKey()) {
  if (data.date > today) throw new BusinessError("The expense date can't be in the future.");
  return db.$transaction(async (tx) => {
    const link = await resolveLink(tx, data.clientId, data.projectId);
    const fields = { date: keyToDate(data.date), category: data.category, description: data.description, vendor: data.vendor, amount: data.amount, gstPaid: data.gstPaid ?? "0", ...link };
    if (!id) {
      const expense = await tx.expense.create({ data: { ...fields, createdById: actorId } });
      await logActivity(tx, { actorId, action: "expense.created", entityType: "Expense", entityId: expense.id, clientId: expense.clientId, changes: { amount: data.amount, category: data.category } });
      return expense;
    }
    const before = await tx.expense.findUnique({ where: { id } });
    if (!before) throw new BusinessError("This expense no longer exists.");
    const expense = await tx.expense.update({ where: { id }, data: fields });
    const changes = diffChanges(
      { date: dateOnlyKey(before.date), category: before.category as string, description: before.description, vendor: before.vendor, amount: before.amount.toString(), gstPaid: before.gstPaid.toString(), clientId: before.clientId, projectId: before.projectId },
      { date: data.date, category: data.category as string, description: data.description, vendor: data.vendor, amount: expense.amount.toString(), gstPaid: expense.gstPaid.toString(), clientId: link.clientId, projectId: link.projectId },
      ["date", "category", "description", "vendor", "amount", "gstPaid", "clientId", "projectId"],
    );
    await logActivity(tx, { actorId, action: "expense.updated", entityType: "Expense", entityId: id, clientId: expense.clientId, changes });
    return expense;
  });
}

export async function setExpenseArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense) throw new BusinessError("This expense no longer exists.");
    await tx.expense.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "expense.archived" : "expense.restored", entityType: "Expense", entityId: id, clientId: expense.clientId, changes: { amount: expense.amount.toString() } });
  });
}

/** Adds or replaces an expense's bill. The old file stays on record, archived. */
export async function attachBill(db: Db, input: { expenseId: string; name: string; storageKey: string; mimeType: string; sizeBytes: number; actorId: string }) {
  await db.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id: input.expenseId } });
    if (!expense || expense.archivedAt) throw new BusinessError("This expense no longer exists.");
    const doc = await tx.document.create({ data: { name: input.name, category: "BILL", storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes, clientId: expense.clientId, projectId: expense.projectId, uploadedById: input.actorId } });
    if (expense.billDocId) await tx.document.updateMany({ where: { id: expense.billDocId }, data: { archivedAt: new Date() } });
    await tx.expense.update({ where: { id: expense.id }, data: { billDocId: doc.id } });
    await logActivity(tx, { actorId: input.actorId, action: "expense.bill_attached", entityType: "Expense", entityId: expense.id, clientId: expense.clientId, changes: { name: input.name } });
  });
}

export async function addClientDocument(db: Db, input: { clientId: string; projectId?: string | null; name: string; category: string; storageKey: string; mimeType: string; sizeBytes: number; actorId: string; canSeeMoney: boolean }) {
  if (isFinanceDocument(input.category) && !input.canSeeMoney) throw new BusinessError("Only an admin can add bills and invoices.");
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true, archivedAt: true } });
    if (!client || client.archivedAt) throw new BusinessError("This client is archived. Restore them first.");
    const doc = await tx.document.create({ data: { name: input.name, category: input.category as never, storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes, clientId: input.clientId, projectId: input.projectId ?? null, uploadedById: input.actorId } });
    await logActivity(tx, { actorId: input.actorId, action: "document.added", entityType: "Document", entityId: doc.id, clientId: input.clientId, changes: { name: input.name, category: input.category } });
    return doc;
  });
}

/** Archiving hides a document but keeps the file. Files belonging to a task, the content calendar or an expense stay with them. */
export async function archiveClientDocument(db: Db, id: string, actorId: string, canSeeMoney: boolean) {
  await db.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc || doc.archivedAt) throw new BusinessError("This document no longer exists.");
    if (isFinanceDocument(doc.category) && !canSeeMoney) throw new BusinessError("This document no longer exists.");
    if (doc.taskId) throw new BusinessError("This file belongs to a task. Remove it from there.");
    if (await tx.contentCalendarItem.count({ where: { creativeDocId: id } })) throw new BusinessError("This file is used in the content calendar. Change it there.");
    if (await tx.expense.count({ where: { billDocId: id } })) throw new BusinessError("This is the bill for an expense. Change it on the expense.");
    await tx.document.update({ where: { id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { actorId, action: "document.archived", entityType: "Document", entityId: id, clientId: doc.clientId, changes: { name: doc.name } });
  });
}

/** A call, meeting or message. A next action with a date becomes a reminder on that date. */
export async function saveCommunication(db: Db, id: string | null, data: CommunicationData, actorId: string, today = todayKey()) {
  if (data.date > today) throw new BusinessError("The date can't be in the future. Use the next action for something still to come.");
  return db.$transaction(async (tx) => {
    if (data.clientId && !(await tx.client.count({ where: { id: data.clientId } }))) throw new BusinessError("That client no longer exists.");
    if (data.leadId && !(await tx.lead.count({ where: { id: data.leadId } }))) throw new BusinessError("That lead no longer exists.");
    const fields = { type: data.type, date: keyToDate(data.date), summary: data.summary, nextAction: data.nextAction, nextActionDate: data.nextActionDate ? keyToDate(data.nextActionDate) : null };
    if (!id) {
      const row = await tx.communicationLog.create({ data: { ...fields, clientId: data.clientId, leadId: data.leadId, createdById: actorId } });
      await logActivity(tx, { actorId, action: "communication.logged", entityType: "CommunicationLog", entityId: row.id, clientId: row.clientId, changes: { type: data.type } });
      return row;
    }
    const before = await tx.communicationLog.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This entry no longer exists.");
    const same = (data.clientId && before.clientId === data.clientId) || (data.leadId && before.leadId === data.leadId);
    if (!same) throw new BusinessError("This entry belongs to someone else.");
    // The client or lead it belongs to doesn't change when it's edited: a lead may have become a client since.
    const row = await tx.communicationLog.update({ where: { id }, data: fields });
    await logActivity(tx, { actorId, action: "communication.updated", entityType: "CommunicationLog", entityId: id, clientId: row.clientId, changes: { type: data.type } });
    return row;
  });
}

export async function archiveCommunication(db: Db, id: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const row = await tx.communicationLog.findUnique({ where: { id } });
    if (!row || row.archivedAt) throw new BusinessError("This entry no longer exists.");
    await tx.communicationLog.update({ where: { id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { actorId, action: "communication.archived", entityType: "CommunicationLog", entityId: id, clientId: row.clientId });
  });
}
