import { cn } from "@/lib/utils";

/**
 * Ranked horizontal bars in plain HTML (direct-labelled, so no legend needed).
 * One series → one colour.
 */
export function BarList({
  items,
  format,
  color = "var(--chart-1)",
  emptyText = "No data for this period",
}: {
  items: { label: string; value: number; hint?: string; href?: string }[];
  format: (v: number) => string;
  color?: string;
  emptyText?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0);
  if (!items.length || max === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="group" title={i.hint ? `${i.label}: ${format(i.value)} · ${i.hint}` : `${i.label}: ${format(i.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{i.label}</span>
            <span className={cn("shrink-0 font-medium tabular-nums", i.value < 0 && "text-tone-red")}>{format(i.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] group-hover:opacity-80"
              style={{ width: `${Math.max(2, (Math.abs(i.value) / max) * 100)}%`, background: i.value < 0 ? "var(--tone-red)" : color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
