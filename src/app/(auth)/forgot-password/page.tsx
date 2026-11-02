"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/server/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/shared/submit-button";
import { FormMessage } from "@/components/shared/form-message";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordResetAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Forgot password</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll email you a link to set a new password.</p>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <SubmitButton className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
