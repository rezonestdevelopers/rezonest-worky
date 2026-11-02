import { Badge } from "@/components/ui/badge";
import { statusDef } from "@/lib/status";

export function StatusBadge({ kind, value, className }: { kind: string; value: string | null | undefined; className?: string }) {
  const def = statusDef(kind, value);
  return (
    <Badge tone={def.tone} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {def.label}
    </Badge>
  );
}
