import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const notice =
    sp.reset === "1"
      ? "Password changed. Please sign in with your new password."
      : sp.error === "inactive"
        ? "Your account is inactive. Please contact the admin."
        : undefined;
  return <LoginForm callbackUrl={sp.callbackUrl} notice={notice} />;
}
