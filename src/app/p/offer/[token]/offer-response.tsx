"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/shared/form-message";
import { acceptOfferAction, requestChangesAction } from "@/server/actions/public-offer";

export function OfferResponse({ token, total }: { token: string; total: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"accept" | "changes" | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = mode === "accept" ? await acceptOfferAction({ token, name, agreed }) : await requestChangesAction({ token, name, comment });
      if (!res.ok) return setError(res.error);
      if (mode === "changes") setSent(true);
      setMode(null);
      router.refresh();
    });

  if (sent) return <FormMessage success="Thanks, we've received your message and will get back to you soon." />;

  return (
    <div className="glass space-y-3 rounded-2xl border p-4 sm:p-6">
      {!mode && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" className="sm:flex-1" onClick={() => setMode("accept")}><Check /> Accept this offer</Button>
          <Button size="lg" variant="outline" className="sm:flex-1" onClick={() => setMode("changes")}><MessageSquare /> Request changes</Button>
        </div>
      )}
      {mode && (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2 className="font-semibold">{mode === "accept" ? "Accept this offer" : "Request changes"}</h2>
          <FormMessage error={error} />
          <div className="space-y-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </div>
          {mode === "accept" ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I accept this offer of {total}, including its terms and conditions, on behalf of the company named above.</span>
            </label>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="comment">What would you like changed?</Label>
              <Textarea id="comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} required />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setMode(null); setError(undefined); }}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {mode === "accept" ? "Confirm acceptance" : "Send request"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
