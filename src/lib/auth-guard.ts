import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";

export type CurrentUser = { id: string; name: string; email: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" };

/** Current logged-in, ACTIVE user (checked against the DB on every request). */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) redirect("/login?error=inactive");
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

/** For pages: redirects to the dashboard with a notice if not allowed. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have permission to do this.");
  }
}

/** For server actions / API routes: throws instead of redirecting. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const session = await auth();
  if (!session?.user?.id) throw new ForbiddenError();
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive || !can(user.role, permission)) throw new ForbiddenError();
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
