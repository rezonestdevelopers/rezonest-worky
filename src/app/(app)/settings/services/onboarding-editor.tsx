"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { saveOnboardingTemplateAction } from "@/server/actions/work";

/** The standard checklist: for one service, or for every client when serviceId is null. One item per line. */
export function OnboardingEditor({ serviceId, title, description, items }: { serviceId: string | null; title: string; description: string; items: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(items.join("\n"));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={Math.max(4, items.length + 1)} value={text} onChange={(e) => setText(e.target.value)} aria-label={`${title}, one item per line`} placeholder="One item per line" />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveOnboardingTemplateAction(serviceId, text);
                if (res.ok) {
                  toast.success(res.message ?? "Saved");
                  router.refresh();
                } else toast.error(res.error);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save checklist
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
