"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { contentResponseSchema } from "@/lib/validators/delivery";
import { respondToContent } from "@/server/services/content";
import { BusinessError } from "@/server/services/shared";

type PublicResult = { ok: true } | { ok: false; error: string };

/** Needs no login. All it can do comes from the token, and it's rate limited. A month can hold many items, so the limit allows for answering each. */
export async function respondToContentAction(input: z.input<typeof contentResponseSchema>): Promise<PublicResult> {
  try {
    const ip = clientIp(await headers());
    if (!rateLimit(`content-response:${ip}`, 120, 15 * 60_000).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
    const parsed = contentResponseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await respondToContent(db, { ...parsed.data, ip });
    revalidatePath(`/p/content/${parsed.data.token}`);
    revalidatePath("/content");
    revalidatePath(`/content/${parsed.data.itemId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again, or contact us directly." };
  }
}
