"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CheckSquare, FileText, Loader2, Receipt, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NAV } from "./nav";

type Result = { id: string; title: string; subtitle?: string; href: string };
type Results = Partial<Record<"clients" | "offers" | "projects" | "tasks" | "invoices", Result[]>>;

const GROUPS = [
  { key: "clients", label: "Clients", icon: Users },
  { key: "offers", label: "Offers", icon: FileText },
  { key: "projects", label: "Projects", icon: Briefcase },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "invoices", label: "Invoices", icon: Receipt },
] as const;

export function CommandPalette({ allowed }: { allowed: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({});
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border bg-card-solid/70 px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search clients, offers, tasks…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl" showClose={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false}>
            <CommandInput placeholder="Type a client, offer no., project, task or invoice no…" value={q} onValueChange={setQ} />
            <CommandList>
              {loading && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching…
                </div>
              )}
              {q.trim().length >= 2 && !loading && <CommandEmpty>No results for “{q}”.</CommandEmpty>}
              {q.trim().length < 2 && (
                <CommandGroup heading="Go to">
                  {NAV.filter((n) => allowed.includes(n.key)).map((n) => (
                    <CommandItem key={n.key} value={n.label} onSelect={() => go(n.href)}>
                      <n.icon /> {n.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {GROUPS.map((g) =>
                results[g.key]?.length ? (
                  <CommandGroup key={g.key} heading={g.label}>
                    {results[g.key]!.map((r) => (
                      <CommandItem key={r.id} value={`${g.key}-${r.id}`} onSelect={() => go(r.href)}>
                        <g.icon />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{r.title}</div>
                          {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null,
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
