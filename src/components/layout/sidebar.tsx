"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CURRENT_PHASE, NAV } from "./nav";

export function SidebarNav({ allowed, onNavigate }: { allowed: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.filter((n) => allowed.includes(n.key)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            // Pre-fetching all 15 sections cost about 15 extra server requests on every page load.
            prefetch={false}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span className="flex-1 truncate">{item.label}</span>
            {item.phase > CURRENT_PHASE && (
              <span className="rounded bg-muted px-1.5 text-[10px] font-normal text-muted-foreground" title={`Coming in Phase ${item.phase}`}>
                P{item.phase}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-6 py-5">
      <Image src="/logo.png" alt="Rezonest" width={132} height={36} className="h-8 w-auto" priority />
      <span className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Work OS</span>
    </Link>
  );
}

export function Sidebar({ allowed }: { allowed: string[] }) {
  return (
    <aside className="glass sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <SidebarBrand />
      <div className="flex-1 overflow-y-auto pb-6">
        <SidebarNav allowed={allowed} />
      </div>
    </aside>
  );
}
