"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backupNowAction } from "@/server/actions/reports";

export function BackupNowButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await backupNowAction();
          if (res.ok) toast.success(res.message ?? "Done");
          else toast.error(res.error);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} Back up now
    </Button>
  );
}
