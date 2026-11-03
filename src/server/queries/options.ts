import "server-only";
import { db } from "@/lib/db";

export type Option = { value: string; label: string };

const toOptions = (rows: { id: string; name: string }[]): Option[] => rows.map((r) => ({ value: r.id, label: r.name }));

/**
 * Choices for lead and client forms. Deactivated items are hidden, except any a record
 * already uses (`keep`), so editing an old record doesn't silently blank its sector.
 */
export async function getFormOptions(keep: (string | null | undefined)[] = []) {
  const keepIds = keep.filter((k): k is string => !!k);
  const active = { OR: [{ isActive: true }, { id: { in: keepIds } }] };
  const [sectors, sources, services, users] = await Promise.all([
    db.sector.findMany({ where: active, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.leadSource.findMany({ where: active, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.service.findMany({ where: active, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: active, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { sectors: toOptions(sectors), sources: toOptions(sources), services: toOptions(services), users: toOptions(users) };
}
export type FormOptions = Awaited<ReturnType<typeof getFormOptions>>;
