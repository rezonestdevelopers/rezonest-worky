import type { Prisma, PrismaClient } from "@prisma/client";
import type { Contactable } from "@/lib/contact-match";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/** A rule was broken (e.g. "already converted"). The message is shown to the user as it is. */
export class BusinessError extends Error {}

export async function logActivity(
  tx: Tx,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    clientId?: string | null;
    changes?: Record<string, unknown>;
  },
) {
  await tx.activityLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      clientId: entry.clientId ?? null,
      changes: entry.changes as Prisma.InputJsonValue | undefined,
    },
  });
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return String(value);
  return value ?? null;
}

/** Old → new values for the fields that really changed. Used for the activity log. */
export function diffChanges<K extends string>(
  before: Partial<Record<K, unknown>>,
  after: Partial<Record<K, unknown>>,
  fields: readonly K[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    const from = comparable(before[field]);
    const to = comparable(after[field]);
    const same =
      JSON.stringify(from) === JSON.stringify(to) ||
      // Decimal columns read back as "25000" where the form may send "25000.00"
      (typeof from === "string" && typeof to === "string" && from !== "" && to !== "" && !Number.isNaN(Number(from)) && Number(from) === Number(to));
    if (!same) changes[field] = { from, to };
  }
  return changes;
}

/** Existing people and companies to compare against when looking for duplicates. */
export async function loadContactables(
  db: Db | Tx,
  opts: { leads: boolean; excludeClientId?: string; excludeLeadId?: string },
): Promise<Contactable[]> {
  const [clients, leads] = await Promise.all([
    db.client.findMany({
      where: opts.excludeClientId ? { id: { not: opts.excludeClientId } } : undefined,
      select: {
        id: true,
        companyName: true,
        phone: true,
        whatsapp: true,
        email: true,
        gstin: true,
        contacts: { where: { archivedAt: null }, select: { phone: true, whatsapp: true, email: true } },
      },
    }),
    opts.leads
      ? db.lead.findMany({
          // A converted lead is represented by its client.
          where: { archivedAt: null, convertedClientId: null, ...(opts.excludeLeadId ? { id: { not: opts.excludeLeadId } } : {}) },
          select: { id: true, contactName: true, companyName: true, phone: true, whatsapp: true, email: true },
        })
      : [],
  ]);
  return [
    ...clients.map((c) => ({
      id: c.id,
      name: c.companyName,
      kind: "client" as const,
      phones: [c.phone, c.whatsapp, ...c.contacts.flatMap((p) => [p.phone, p.whatsapp])],
      emails: [c.email, ...c.contacts.map((p) => p.email)],
      gstin: c.gstin,
    })),
    ...leads.map((l) => ({
      id: l.id,
      name: l.companyName ? `${l.companyName} (${l.contactName})` : l.contactName,
      kind: "lead" as const,
      phones: [l.phone, l.whatsapp],
      emails: [l.email],
    })),
  ];
}
