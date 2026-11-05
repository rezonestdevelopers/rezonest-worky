import { templateDefinition, unknownPlaceholders } from "@/lib/email-templates";
import { BusinessError, logActivity, type Db } from "./shared";

/** The saved text, or the starting text if it's never been edited. */
export async function getTemplate(db: Db, key: string) {
  const definition = templateDefinition(key);
  if (!definition) throw new Error(`Unknown email template: ${key}`);
  const row = await db.emailTemplate.findUnique({ where: { key } });
  return { key, name: definition.name, subject: row?.subject ?? definition.subject, body: row?.body ?? definition.body, whatsapp: row ? row.whatsapp : definition.whatsapp };
}

export async function saveTemplate(db: Db, input: { key: string; subject: string; body: string; whatsapp: string | null }, actorId: string) {
  const definition = templateDefinition(input.key);
  if (!definition) throw new BusinessError("This template no longer exists.");
  const unknown = unknownPlaceholders(input.key, [input.subject, input.body, input.whatsapp ?? ""].join("\n"));
  if (unknown.length) throw new BusinessError(`These can't be filled in: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Check the spelling against the list.`);
  const whatsapp = definition.whatsapp === null ? null : input.whatsapp;
  const fields = { subject: input.subject, body: input.body, whatsapp };
  await db.emailTemplate.upsert({ where: { key: input.key }, create: { key: input.key, name: definition.name, ...fields }, update: fields });
  await logActivity(db, { actorId, action: "email_template.updated", entityType: "EmailTemplate", entityId: input.key, changes: { name: definition.name } });
}

/** Back to the starting text. */
export async function resetTemplate(db: Db, key: string, actorId: string) {
  const definition = templateDefinition(key);
  if (!definition) throw new BusinessError("This template no longer exists.");
  const fields = { subject: definition.subject, body: definition.body, whatsapp: definition.whatsapp };
  await db.emailTemplate.upsert({ where: { key }, create: { key, name: definition.name, ...fields }, update: fields });
  await logActivity(db, { actorId, action: "email_template.reset", entityType: "EmailTemplate", entityId: key, changes: { name: definition.name } });
}
