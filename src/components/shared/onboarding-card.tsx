"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { onboardingPercent } from "@/lib/work-plan";
import { addOnboardingItemAction, removeOnboardingItemAction, setOnboardingItemAction } from "@/server/actions/work";

export function OnboardingCard({
  checklistId, items, readOnly = false,
}: {
  checklistId: string;
  items: { id: string; title: string; isDone: boolean; doneAt: string | null }[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const done = items.filter((i) => i.isDone).length;
  const percent = onboardingPercent(done, items.length);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else toast.error(res.error ?? "Something went wrong");
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Client onboarding</CardTitle>
          <CardDescription>{done} of {items.length} done</CardDescription>
        </div>
        <span className="text-lg font-semibold tabular-nums" data-testid="onboarding-percent">{percent}%</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress">
          <div className="h-full rounded-full" style={{ width: `${percent}%`, background: "var(--chart-3)" }} />
        </div>
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 text-sm">
              <label className="flex min-w-0 items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={i.isDone} disabled={pending || readOnly} onChange={(e) => run(() => setOnboardingItemAction(i.id, e.target.checked))} />
                <span>
                  <span className={i.isDone ? "text-muted-foreground line-through" : ""}>{i.title}</span>
                  {i.doneAt && <span className="ml-1 text-xs whitespace-nowrap text-muted-foreground">({i.doneAt})</span>}
                </span>
              </label>
              {!readOnly && !i.isDone && (
                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Remove ${i.title}`} onClick={() => run(() => removeOnboardingItemAction(i.id))}><X /></Button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) run(() => addOnboardingItemAction(checklistId, title), () => setTitle(""));
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an item…" aria-label="Add onboarding item" className="h-8" />
            <Button type="submit" variant="outline" size="sm" disabled={pending || !title.trim()}><Plus /> Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
