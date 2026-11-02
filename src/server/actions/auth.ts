"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signIn, signOut, LOCK_MINUTES } from "@/auth";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { fillTemplate, sendMail } from "@/lib/mailer";

export type FormState = { error?: string; success?: string } | undefined;

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const ip = clientIp(await headers());
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const limit = rateLimit(`login:${ip}`, Number(process.env.LOGIN_RATE_LIMIT ?? 10), 15 * 60_000);
  if (!limit.ok) return { error: `Too many attempts. Please try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` };

  // Only ever redirect to a path on this site (never to another domain).
  let safeCallback = "/dashboard";
  try {
    const u = new URL(String(formData.get("callbackUrl") ?? "/dashboard"), "http://local");
    if (u.pathname.startsWith("/") && !u.pathname.startsWith("//") && u.pathname !== "/login") safeCallback = u.pathname + u.search;
  } catch {
    /* keep default */
  }
  try {
    await signIn("credentials", { email, password: String(formData.get("password") ?? ""), redirectTo: safeCallback });
  } catch (e) {
    if (e instanceof AuthError) {
      if ((e as AuthError & { code?: string }).code === "locked") {
        return { error: `Too many wrong passwords. This account is locked for ${LOCK_MINUTES} minutes.` };
      }
      return { error: "Wrong email or password." };
    }
    throw e; // redirect on success
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

const RESET_TTL_MIN = 60;

export async function requestPasswordResetAction(_: FormState, formData: FormData): Promise<FormState> {
  const ip = clientIp(await headers());
  if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000).ok) return { error: "Too many requests. Please try again later." };

  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Please enter a valid email address." };

  const generic = { success: "If an account exists for that email, a reset link has been sent. It is valid for 1 hour." };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  if (!user || !user.isActive) return generic;

  const token = crypto.randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
    },
  });
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  const tpl = await db.emailTemplate.findUnique({ where: { key: "password_reset" } });
  const values = { name: user.name, resetLink: link };
  await sendMail({
    to: user.email,
    subject: fillTemplate(tpl?.subject ?? "Reset your password", values),
    text: fillTemplate(tpl?.body ?? "Reset your password: {{resetLink}}", values),
    templateKey: "password_reset",
    entityType: "User",
    entityId: user.id,
  });
  return generic;
}

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200)
  .regex(/[A-Za-z]/, "Password must contain a letter.")
  .regex(/[0-9]/, "Password must contain a number.");

export async function resetPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired. Please request a new one." };
  }
  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: { passwordHash: await bcrypt.hash(password, 12), failedLoginCount: 0, lockedUntil: null },
    }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
  ]);
  redirect("/login?reset=1");
}
