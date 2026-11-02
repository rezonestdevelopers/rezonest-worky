import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (used by middleware). No database / bcrypt here.
 * The Credentials provider lives in src/auth.ts.
 */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/p/", "/api/auth", "/api/cron", "/api/files/public/"];

export const SESSION_MAX_AGE = Number(process.env.SESSION_MAX_AGE_HOURS ?? 12) * 60 * 60;

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: "ADMIN" | "MANAGER" | "EMPLOYEE" }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "ADMIN" | "MANAGER" | "EMPLOYEE";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
