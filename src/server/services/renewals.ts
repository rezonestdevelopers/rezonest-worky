import { dateOnlyKey, keyToDate } from "@/lib/dates";
import type { AssetData } from "@/lib/validators/delivery";
import { BusinessError, diffChanges, logActivity, type Db } from "./shared";

const FIELDS = ["clientId", "kind", "name", "provider", "plan", "purchaseDate", "expiryDate", "emailAccounts", "costPrice", "renewalPrice", "autoRenew", "credentialsLocation", "notes"] as const;

export async function saveAsset(db: Db, id: string | null, data: AssetData, actorId: string) {
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: data.clientId } });
    if (!client || client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");
    const name = data.kind === "DOMAIN" ? data.name.toLowerCase() : data.name;
    const duplicate = await tx.domainHostingAsset.findFirst({ where: { clientId: data.clientId, kind: data.kind, name: { equals: name, mode: "insensitive" }, archivedAt: null, ...(id ? { id: { not: id } } : {}) } });
    if (duplicate) throw new BusinessError("This is already being tracked for this client.");
    const fields = {
      clientId: data.clientId,
      kind: data.kind,
      name,
      provider: data.provider,
      plan: data.plan,
      purchaseDate: data.purchaseDate ? keyToDate(data.purchaseDate) : null,
      expiryDate: keyToDate(data.expiryDate),
      emailAccounts: data.emailAccounts,
      costPrice: data.costPrice,
      renewalPrice: data.renewalPrice,
      autoRenew: data.autoRenew,
      credentialsLocation: data.credentialsLocation,
      notes: data.notes,
    };
    if (!id) {
      const asset = await tx.domainHostingAsset.create({ data: fields });
      await logActivity(tx, { actorId, action: "renewal.added", entityType: "DomainHostingAsset", entityId: asset.id, clientId: asset.clientId, changes: { kind: asset.kind, name: asset.name, expires: data.expiryDate } });
      return asset;
    }
    const before = await tx.domainHostingAsset.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This item no longer exists.");
    const after = await tx.domainHostingAsset.update({ where: { id }, data: fields });
    const changes = diffChanges(before, after, FIELDS);
    if (Object.keys(changes).length) await logActivity(tx, { actorId, action: "renewal.updated", entityType: "DomainHostingAsset", entityId: id, clientId: after.clientId, changes });
    return after;
  });
}

/** Renewed with the provider: the expiry moves on, and the old date stays in the history. */
export async function renewAsset(db: Db, input: { assetId: string; newExpiry: string; actorId: string }) {
  await db.$transaction(async (tx) => {
    const asset = await tx.domainHostingAsset.findUnique({ where: { id: input.assetId } });
    if (!asset || asset.archivedAt) throw new BusinessError("This item no longer exists.");
    const current = dateOnlyKey(asset.expiryDate);
    if (input.newExpiry <= current) throw new BusinessError("The new expiry date must be after the current one.");
    const { count } = await tx.domainHostingAsset.updateMany({ where: { id: asset.id, expiryDate: asset.expiryDate }, data: { expiryDate: keyToDate(input.newExpiry) } });
    if (!count) throw new BusinessError("This was just renewed by someone else. Please reload.");
    await logActivity(tx, { actorId: input.actorId, action: "renewal.renewed", entityType: "DomainHostingAsset", entityId: asset.id, clientId: asset.clientId, changes: { name: asset.name, expiry: { from: current, to: input.newExpiry } } });
  });
}

export async function setAssetArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const asset = await tx.domainHostingAsset.findUnique({ where: { id } });
    if (!asset) throw new BusinessError("This item no longer exists.");
    await tx.domainHostingAsset.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "renewal.archived" : "renewal.restored", entityType: "DomainHostingAsset", entityId: id, clientId: asset.clientId, changes: { name: asset.name } });
  });
}
