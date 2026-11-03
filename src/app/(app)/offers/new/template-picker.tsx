"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BLANK = "__blank";

export function TemplatePicker({ templates, selected }: { templates: { value: string; label: string }[]; selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="glass flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <Label htmlFor="template">Start from a template</Label>
      <Select
        value={selected || BLANK}
        onValueChange={(v) => {
          const next = new URLSearchParams(sp.toString());
          if (v === BLANK) next.delete("template");
          else next.set("template", v);
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
      >
        <SelectTrigger id="template" size="sm" className="w-full sm:w-72"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={BLANK}>Blank offer</SelectItem>
          {templates.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
