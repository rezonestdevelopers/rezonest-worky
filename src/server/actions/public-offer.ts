"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { publicAcceptSchema, publicChangesSchema } from "@/lib/validators/offer";
import { acceptOfferViaLink, requestChangesViaLink } from "@/server/services/offers";
import { BusinessError } from "@/server/services/shared";

type PublicResult = { ok: true } | { ok: false; error: string };

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function tellAgency(subject: string, text: string, offerId: string) {
  const settings = await db.settings.findUnique({ where: { id: "agency" }, select: { email: true } });
  if (settings?.email) await sendMail({ to: settings.email, subject, text, entityType: "Offer", entityId: offerId });
}

/** These two actions need no login. All they can do comes from the token, and they're rate limited. */
async function guarded(fn: (ip: string) => Promise<PublicResult>): Promise<PublicResult> {
  try {
    const ip = clientIp(await headers());
    if (!rateLimit(`offer-response:${ip}`, 10, 15 * 60_000).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
    return await fn(ip);
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again, or contact us directly." };
  }
}

export async function acceptOfferAction(input: { token: string; name: string; agreed: boolean }): Promise<PublicResult> {
  return guarded(async (ip) => {
    const parsed = publicAcceptSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const offer = await acceptOfferViaLink(db, { token: parsed.data.token, name: parsed.data.name, ip });
    await tellAgency(
      `Offer ${offer.number} accepted`,
      `${parsed.data.name} accepted “${offer.title}” (IP ${ip}).\n\nOpen it: ${appUrl()}/offers/${offer.id}`,
      offer.id,
    );
    revalidatePath(`/p/offer/${parsed.data.token}`);
    revalidatePath(`/offers/${offer.id}`);
    return { ok: true };
  });
}

export async function requestChangesAction(input: { token: string; name: string; comment: string }): Promise<PublicResult> {
  return guarded(async (ip) => {
    const parsed = publicChangesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const offer = await requestChangesViaLink(db, { ...parsed.data, ip });
    await tellAgency(
      `Changes requested on offer ${offer.number}`,
      `${parsed.data.name} asked for changes to “${offer.title}”:\n\n${parsed.data.comment}\n\nOpen it: ${appUrl()}/offers/${offer.id}`,
      offer.id,
    );
    revalidatePath(`/p/offer/${parsed.data.token}`);
    revalidatePath(`/offers/${offer.id}`);
    return { ok: true };
  });
}
