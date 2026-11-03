"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Opt = { id: string; name: string };
const ALL = "__all";

export function FiltersBar({
  presets,
  preset,
  from,
  to,
  options,
}: {
  presets: Record<string, string>;
  preset: string;
  from: string;
  to: string;
  options: { sectors: Opt[]; services: Opt[]; departments: Opt[]; employees: Opt[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === ALL || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("alerts");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const active = ["sector", "service", "dept", "emp"].some((k) => sp.get(k)) || (sp.get("range") && sp.get("range") !== "this_month");

  const dim = (key: string, label: string, list: Opt[]) => (
    <Select value={sp.get(key) ?? ALL} onValueChange={(v) => update({ [key]: v })}>
      <SelectTrigger size="sm" className="w-full min-w-0 sm:w-auto sm:max-w-48" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      <Select value={preset} onValueChange={(v) => update({ range: v, ...(v !== "custom" ? { from: null, to: null } : { from, to }) })}>
        <SelectTrigger size="sm" className="col-span-2 w-full sm:w-auto" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(presets).map(([k, v]) => (
            <SelectItem key={k} value={k}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" && (
        <div className="col-span-2 flex items-center gap-1.5">
          <Input type="date" aria-label="From date" className="h-8 w-full sm:w-36" defaultValue={from} max={to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" className="h-8 w-full sm:w-36" defaultValue={to} min={from} onChange={(e) => e.target.value && update({ to: e.target.value })} />
        </div>
      )}
      {dim("sector", "Sectors", options.sectors)}
      {dim("service", "Services", options.services)}
      {dim("dept", "Departments", options.departments)}
      {dim("emp", "Employees", options.employees)}
      {active && (
        <Button variant="ghost" size="sm" onClick={() => startTransition(() => router.replace(`${pathname}?`, { scroll: false }))}>
          <X /> Clear
        </Button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
    </div>
  );
}
