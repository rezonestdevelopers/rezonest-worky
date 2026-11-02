import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Phase 1: shows the count of unread notifications; full bell menu arrives in Phase 6. */
export function NotificationBell({ count }: { count: number }) {
  return (
    <Button variant="ghost" size="icon" asChild aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}>
      <Link href="/dashboard#alerts" className="relative">
        <Bell />
        {count > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
