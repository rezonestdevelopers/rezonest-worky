import { budgetTone } from "@/lib/ad-metrics";
import { cn } from "@/lib/utils";

const FILL = { grey: "var(--muted-foreground)", green: "var(--chart-3)", amber: "var(--tone-amber)", red: "var(--tone-red)" };

/** How much of the client's budget is gone. The bar stops at 100%, while the number can pass it. */
export function BudgetBar({ utilisation, alertPercent, className }: { utilisation: number | null; alertPercent: number; className?: string }) {
  const tone = budgetTone(utilisation, alertPercent);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.min(utilisation ?? 0, 100)}%`, background: FILL[tone] }} />
      </div>
      <span className={cn("w-12 text-right text-xs tabular-nums", tone === "red" && "font-medium text-tone-red")}>{utilisation === null ? "—" : `${utilisation}%`}</span>
    </div>
  );
}
