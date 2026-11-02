import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, hint, icon: Icon = Inbox, className }: { title: string; hint?: string; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 py-8 text-center", className)}>
      <Icon className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
