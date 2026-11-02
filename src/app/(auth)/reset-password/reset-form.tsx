"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/server/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/shared/submit-button";
import { FormMessage } from "@/components/shared/form-message";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="text-sm text-muted-foreground">At least 8 characters, with a letter and a number.</p>
      </div>
      <FormMessage error={state?.error} />
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <SubmitButton className="w-full" pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
