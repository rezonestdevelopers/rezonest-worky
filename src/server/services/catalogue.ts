import type { z } from "zod";
import { slugify, type masterItemSchema, type serviceSchema, type subServicesSchema, type taskTemplateSchema } from "@/lib/validators/catalogue";
import { BusinessError, diffChanges, logActivity, type Db } from "./shared";

const SERVICE_FIELDS = [
  "name", "departmentId", "billingType", "defaultPrice", "unit", "gstRate", "sacCode", "revisionsIncluded", "isActive",
] as const;

export async function saveService(db: Db, id: string | undefined, data: z.output<typeof serviceSchema>, actorId: string) {
  return db.$transaction(async (tx) => {
    if (!id) {
      const base = slugify(data.name);
      let slug = base;
      for (let n = 2; await tx.service.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
      const count = await tx.service.count();
      const service = await tx.service.create({ data: { ...data, slug, sortOrder: count } });
      await logActivity(tx, { actorId, action: "service.created", entityType: "Service", entityId: service.id, changes: { name: data.name } });
      return service;
    }
    const before = await tx.service.findUnique({ where: { id } });
    if (!before) throw new BusinessError("This service no longer exists.");
    const after = await tx.service.update({ where: { id }, data });
    const changes = diffChanges(before, after, SERVICE_FIELDS);
    if (Object.keys(changes).length) {
      await logActivity(tx, { actorId, action: "service.updated", entityType: "Service", entityId: id, changes });
    }
    return after;
  });
}

/** Sub-services are never deleted, because old offers refer to them. They can be deactivated. */
export async function saveSubServices(db: Db, input: z.output<typeof subServicesSchema>, actorId: string) {
  await db.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: input.serviceId }, include: { subServices: true } });
    if (!service) throw new BusinessError("This service no longer exists.");
    const known = new Set(service.subServices.map((s) => s.id));

    // Clear names first, so swapping two names doesn't trip the "unique name" rule.
    for (const sub of service.subServices) {
      await tx.subService.update({ where: { id: sub.id }, data: { name: `__renaming_${sub.id}` } });
    }
    const kept = new Set<string>();
    for (const [sortOrder, item] of input.items.entries()) {
      const data = { name: item.name, billingType: item.billingType, defaultPrice: item.defaultPrice, unit: item.unit, isActive: item.isActive, sortOrder };
      if (item.id) {
        if (!known.has(item.id)) throw new BusinessError("A sub-service in this list no longer exists. Please reload the page.");
        await tx.subService.update({ where: { id: item.id }, data });
        kept.add(item.id);
      } else {
        await tx.subService.create({ data: { ...data, serviceId: service.id } });
      }
    }
    for (const sub of service.subServices) {
      if (!kept.has(sub.id)) throw new BusinessError("Sub-services can't be removed, only deactivated. Please reload the page.");
    }
    await logActivity(tx, {
      actorId, action: "service.sub_services_updated", entityType: "Service", entityId: service.id, changes: { count: input.items.length },
    });
  });
}

/**
 * Saves a task template. Each step starts when the previous one ends. Changing a template
 * only affects tasks created later; tasks that already exist stay as they are.
 */
export async function saveTaskTemplate(db: Db, input: z.output<typeof taskTemplateSchema>, actorId: string) {
  return db.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: input.serviceId } });
    if (!service) throw new BusinessError("This service no longer exists.");

    let offset = 0;
    const steps = input.steps.map((step, sortOrder) => {
      const row = { ...step, sortOrder, offsetDays: offset };
      offset += step.durationDays;
      return row;
    });
    const fields = { name: input.name, subServiceId: input.subServiceId, isActive: input.isActive };

    let templateId = input.id;
    if (templateId) {
      const { count } = await tx.taskTemplate.updateMany({ where: { id: templateId, serviceId: service.id }, data: fields });
      if (!count) throw new BusinessError("This template no longer exists.");
      await tx.taskTemplateStep.deleteMany({ where: { templateId } });
      await tx.taskTemplateStep.createMany({ data: steps.map((s) => ({ ...s, templateId: templateId! })) });
    } else {
      const created = await tx.taskTemplate.create({ data: { ...fields, serviceId: service.id, steps: { create: steps } } });
      templateId = created.id;
    }
    await logActivity(tx, {
      actorId, action: input.id ? "task_template.updated" : "task_template.created", entityType: "TaskTemplate", entityId: templateId,
      changes: { name: input.name, steps: steps.length },
    });
    return { id: templateId };
  });
}

/** Sectors, lead sources and departments. They're deactivated rather than deleted, so history stays correct. */
export async function saveMasterItem(db: Db, input: z.output<typeof masterItemSchema>, actorId: string) {
  return db.$transaction(async (tx) => {
    const data = { name: input.name, isActive: input.isActive };
    const count = (table: typeof input.kind) =>
      table === "sector" ? tx.sector.count() : table === "leadSource" ? tx.leadSource.count() : tx.department.count();
    let id = input.id;
    if (input.kind === "sector") {
      id = id ? (await tx.sector.update({ where: { id }, data })).id : (await tx.sector.create({ data: { ...data, sortOrder: await count("sector") } })).id;
    } else if (input.kind === "leadSource") {
      id = id ? (await tx.leadSource.update({ where: { id }, data })).id : (await tx.leadSource.create({ data: { ...data, sortOrder: await count("leadSource") } })).id;
    } else {
      id = id ? (await tx.department.update({ where: { id }, data })).id : (await tx.department.create({ data: { ...data, sortOrder: await count("department") } })).id;
    }
    await logActivity(tx, { actorId, action: `${input.kind}.saved`, entityType: input.kind, entityId: id, changes: data });
    return { id };
  });
}
