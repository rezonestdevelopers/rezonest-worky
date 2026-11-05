"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendDigestNowAction } from "@/server/actions/email-templates";

/** See how today's digest reads. The regular one still goes out as usual. */
export function SendDigestButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await sendDigestNowAction();
          if (res.ok) toast.success(res.message ?? "Sent");
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />} Send me today&apos;s digest
    </Button>
  );
}
