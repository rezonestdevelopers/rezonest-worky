"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ListFilter = { key: string; label: string; allLabel?: string; options: { value: string; label: string }[] };

const ALL = "__all";

/** Search box, filters and Excel export for a list. Everything is kept in the URL. */
export function ListToolbar({ placeholder, filters, exportHref, keep = [] }: { placeholder: string; filters: ListFilter[]; exportHref?: string; keep?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Every change goes through here, so "Clear" takes the same route as a search or filter.
  const navigate = (params: URLSearchParams, firstTry = true) => {
    const target = params.toString();
    const url = `${pathname}?${target}`;
    const before = window.location.search;
    clearTimeout(retry.current);
    startTransition(() => router.replace(url, { scroll: false }));
    // Next.js occasionally drops a page change on busy pages, with no error (D-54). So: ask again, then load the page.
    // Only if the address hasn't moved at all: any change means it worked, or you've since sorted or changed page.
    if (new URLSearchParams(before).toString() === target) return;
    retry.current = setTimeout(() => {
      if (window.location.search !== before) return;
      if (firstTry) navigate(params, false);
      else window.location.assign(url);
    }, 2000);
  };

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    navigate(next);
  };

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(retry.current);
    },
    [],
  );

  const onSearch = (value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value.trim() || null }), 300);
  };

  const active = !!sp.get("q") || filters.some((f) => sp.get(f.key));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:w-64">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {filters.map((f) => (
          <Select key={f.key} value={sp.get(f.key) ?? ALL} onValueChange={(v) => apply({ [f.key]: v })}>
            <SelectTrigger size="sm" className="w-full min-w-0 sm:w-auto sm:max-w-48 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:text-left" aria-label={f.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{f.allLabel ?? `${f.label}: all`}</SelectItem>
              {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            navigate(new URLSearchParams(keep.flatMap((k) => (sp.get(k) ? [[k, sp.get(k)!]] : []))));
          }}
        >
          <X /> Clear
        </Button>
      )}
      {exportHref && (
        <Button variant="outline" size="sm" asChild className="sm:ml-auto">
          <a href={`${exportHref}?${sp.toString()}`} download><Download /> Excel</a>
        </Button>
      )}
    </div>
  );
}
