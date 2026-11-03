import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ClientCreateData, ClientData, contactSchema } from "@/lib/validators/client";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

const CLIENT_FIELDS = [
  "companyName", "phone", "whatsapp", "email", "website", "sectorId", "city", "state", "stateCode", "country",
  "billingAddress", "pincode", "gstin", "pan", "leadSourceId", "accountManagerId", "tags", "notes", "status",
] as const;

function clientColumns(d: ClientData) {
  return {
    companyName: d.companyName,
    phone: d.phone,
    whatsapp: d.whatsapp,
    email: d.email,
    website: d.website,
    sectorId: d.sectorId,
    city: d.city,
    state: d.state,
    stateCode: d.stateCode,
    country: d.country,
    billingAddress: d.billingAddress,
    pincode: d.pincode,
    gstin: d.gstin,
    pan: d.pan,
    leadSourceId: d.leadSourceId,
    accountManagerId: d.accountManagerId,
    tags: d.tags,
    notes: d.notes,
    status: d.status,
  } satisfies Prisma.ClientUncheckedCreateInput;
}

/** Creates a client and its primary contact. Must run inside a transaction. */
export async function createClientInTx(tx: Tx, data: ClientCreateData, actorId: string | null, createdVia = "client.created") {
  const client = await tx.client.create({
    data: {
      ...clientColumns(data),
      createdById: actorId,
      contacts: {
        create: {
          name: data.contactName,
          designation: data.contactDesignation,
          phone: data.phone,
          whatsapp: data.whatsapp,
          email: data.email,
          isPrimary: true,
        },
      },
    },
  });
  await logActivity(tx, { actorId, action: createdVia, entityType: "Client", entityId: client.id, clientId: client.id });
  return client;
}

export function createClient(db: Db, data: ClientCreateData, actorId: string) {
  return db.$transaction((tx) => createClientInTx(tx, data, actorId));
}

export async function updateClient(db: Db, id: string, data: ClientData, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.client.findUnique({ where: { id } });
    if (!before) throw new BusinessError("This client no longer exists.");
    if (before.archivedAt) throw new BusinessError("This client is archived. Restore it before making changes.");
    const after = await tx.client.update({ where: { id }, data: clientColumns(data) });
    const changes = diffChanges(before, after, CLIENT_FIELDS);
    if (Object.keys(changes).length) {
      await logActivity(tx, { actorId, action: "client.updated", entityType: "Client", entityId: id, clientId: id, changes });
    }
    return after;
  });
}

/**
 * Archived clients drop out of the dashboard, so a client who still owes money or has
 * running work can't be archived: the outstanding total would quietly become wrong.
 */
export async function archiveBlockers(db: Db | Tx, id: string): Promise<string[]> {
  const [unpaid, projects] = await Promise.all([
    db.invoice.count({ where: { clientId: id, type: "TAX", status: "ISSUED", balanceDue: { gt: 0 } } }),
    db.project.count({ where: { clientId: id, archivedAt: null, status: { in: ["NOT_STARTED", "ACTIVE", "ON_HOLD"] } } }),
  ]);
  const blockers: string[] = [];
  if (unpaid) blockers.push(`${unpaid} unpaid invoice${unpaid === 1 ? "" : "s"}`);
  if (projects) blockers.push(`${projects} running project${projects === 1 ? "" : "s"}`);
  return blockers;
}

export async function archiveClient(db: Db, id: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) throw new BusinessError("This client no longer exists.");
    if (client.archivedAt) return;
    const blockers = await archiveBlockers(tx, id);
    if (blockers.length) throw new BusinessError(`This client can't be archived yet. It still has ${blockers.join(" and ")}.`);
    await tx.client.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await logActivity(tx, {
      actorId, action: "client.archived", entityType: "Client", entityId: id, clientId: id,
      changes: { status: { from: client.status, to: "ARCHIVED" } },
    });
  });
}

export async function restoreClient(db: Db, id: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) throw new BusinessError("This client no longer exists.");
    if (!client.archivedAt) return;
    await tx.client.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null } });
    await logActivity(tx, {
      actorId, action: "client.restored", entityType: "Client", entityId: id, clientId: id,
      changes: { status: { from: "ARCHIVED", to: "ACTIVE" } },
    });
  });
}

type ContactData = z.output<typeof contactSchema>;

/** Adds or edits a contact person. A client always has exactly one primary contact. */
export async function saveContact(db: Db, clientId: string, contactId: string | undefined, data: ContactData, actorId: string) {
  return db.$transaction(async (tx) => {
    const others = await tx.clientContact.count({
      where: { clientId, archivedAt: null, isPrimary: true, ...(contactId ? { id: { not: contactId } } : {}) },
    });
    if (!data.isPrimary && others === 0) {
      throw new BusinessError("A client needs one primary contact. Make another contact primary instead.");
    }
    if (data.isPrimary) {
      await tx.clientContact.updateMany({
        where: { clientId, isPrimary: true, ...(contactId ? { id: { not: contactId } } : {}) },
        data: { isPrimary: false },
      });
    }
    let contact;
    if (contactId) {
      const { count } = await tx.clientContact.updateMany({ where: { id: contactId, clientId, archivedAt: null }, data });
      if (!count) throw new BusinessError("This contact no longer exists.");
      contact = { id: contactId };
    } else {
      contact = await tx.clientContact.create({ data: { ...data, clientId } });
    }
    await logActivity(tx, {
      actorId, action: contactId ? "client.contact_updated" : "client.contact_added", entityType: "ClientContact",
      entityId: contact.id, clientId, changes: { name: data.name },
    });
    return contact;
  });
}

export async function archiveContact(db: Db, clientId: string, contactId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId, archivedAt: null } });
    if (!contact) throw new BusinessError("This contact no longer exists.");
    if (contact.isPrimary) throw new BusinessError("Make another contact primary before removing this one.");
    await tx.clientContact.update({ where: { id: contactId }, data: { archivedAt: new Date() } });
    await logActivity(tx, {
      actorId, action: "client.contact_removed", entityType: "ClientContact", entityId: contactId, clientId, changes: { name: contact.name },
    });
  });
}
