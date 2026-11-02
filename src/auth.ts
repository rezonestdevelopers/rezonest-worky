import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
// Used to keep response time the same when the email doesn't exist.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("timing-equaliser-not-a-password", 12));

class AccountLockedError extends CredentialsSignin {
  code = "locked";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          await bcrypt.compare(password, getDummyHash());
          return null;
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) throw new AccountLockedError();

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const failed = user.failedLoginCount + 1;
          await db.user.update({
            where: { id: user.id },
            data:
              failed >= MAX_FAILED_LOGINS
                ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
                : { failedLoginCount: failed },
          });
          return null;
        }

        await db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
});
