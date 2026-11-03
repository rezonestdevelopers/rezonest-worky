import "server-only";
import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { assertPermission, ForbiddenError, type CurrentUser } from "@/lib/auth-guard";
import type { Permission } from "@/lib/permissions";
import { BusinessError } from "./services/shared";

/**
 * Wraps every server action: checks permission first, then turns known problems
 * into friendly messages. Unexpected errors are logged and never shown to the user.
 */
export async function runAction(permission: Permission, fn: (user: CurrentUser) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn(await assertPermission(permission));
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof BusinessError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { ok: false, error: "That name is already in use. Please choose another." };
      if (e.code === "P2003") return { ok: false, error: "One of the selected items no longer exists. Please reload and try again." };
      if (e.code === "P2025") return { ok: false, error: "This record no longer exists. Please reload the page." };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong and nothing was saved. Please try again." };
  }
}
