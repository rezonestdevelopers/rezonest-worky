"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlarmClockOff, AlertOctagon, AlertTriangle, Check, Clock, Info, MoreHorizontal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { updateAlertAction, restoreSnoozedAction } from "@/server/actions/alerts";
import type { Alert, AlertCategory } from "@/server/queries/dashboard/alerts";
import { cn } from "@/lib/utils";

const SEVERITY = {
  CRITICAL: { icon: AlertOctagon, cls: "text-tone-red", bar: "bg-tone-red", label: "Critical" },
  WARNING: { icon: AlertTriangle, cls: "text-tone-amber", bar: "bg-tone-amber", label: "Warning" },
  INFO: { icon: Info, cls: "text-tone-blue", bar: "bg-tone-blue", label: "Info" },
} as const;

const PAGE = 12;

export function AlertsPanel({
  alerts,
  categories,
  hiddenCount,
}: {
  alerts: Alert[];
  categories: Record<AlertCategory, string>;
  hiddenCount: number;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const initial = (sp.get("alerts") as AlertCategory | null) ?? null;
  const [cat, setCat] = useState<AlertCategory | null>(initial && initial in categories ? initial : null);
  const [shown, setShown] = useState(PAGE);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<Alert | null>(null);
  const [customDays, setCustomDays] = useState("7");
  const [, startTransition] = useTransition();

  // keep in sync when Today strip links change ?alerts=
  const urlCat = sp.get("alerts") as AlertCategory | null;
  const [lastUrlCat, setLastUrlCat] = useState(urlCat);
  if (urlCat !== lastUrlCat) {
    setLastUrlCat(urlCat);
    setCat(urlCat && urlCat in categories ? urlCat : null);
    setShown(PAGE);
  }

  const live = useMemo(() => alerts.filter((a) => !gone.has(a.key)), [alerts, gone]);
  const counts = useMemo(() => {
    const c: Partial<Record<AlertCategory, number>> = {};
    for (const a of live) c[a.category] = (c[a.category] ?? 0) + 1;
    return c;
  }, [live]);
  const list = cat ? live.filter((a) => a.category === cat) : live;

  const act = (a: Alert, action: "snooze" | "done", days?: number) => {
    setGone((g) => new Set(g).add(a.key));
    startTransition(async () => {
      const res = await updateAlertAction({
        key: a.key, type: a.type, title: a.title, entityType: a.entityType, entityId: a.entityId, href: a.href, action, days,
      });
      if (!res.ok) {
        setGone((g) => {
          const n = new Set(g);
          n.delete(a.key);
          return n;
        });
        toast.error(res.error ?? "Something went wrong");
      } else {
        toast.success(action === "done" ? "Marked as done" : `Snoozed for ${days} day${days === 1 ? "" : "s"}`);
      }
    });
  };

  const critical = live.filter((a) => a.severity === "CRITICAL").length;

  return (
    <Card id="alerts" className="scroll-mt-20">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Alerts &amp; reminders
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{live.length}</span>
          </CardTitle>
          <CardDescription>
            {critical ? `${critical} need attention now` : "Nothing critical"}
            {hiddenCount > 0 && ` · ${hiddenCount} snoozed or done`}
          </CardDescription>
        </div>
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              startTransition(async () => {
                await restoreSnoozedAction();
                setGone(new Set());
                router.refresh();
                toast.success("Snoozed alerts restored");
              })
            }
          >
            <AlarmClockOff /> Restore snoozed
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Alert categories">
          <Chip active={!cat} onClick={() => { setCat(null); setShown(PAGE); }} label="All" count={live.length} />
          {(Object.keys(categories) as AlertCategory[])
            .filter((k) => counts[k])
            .map((k) => (
              <Chip key={k} active={cat === k} onClick={() => { setCat(k); setShown(PAGE); }} label={categories[k]} count={counts[k] ?? 0} />
            ))}
        </div>

        {list.length === 0 ? (
          <EmptyState title="All clear" hint="No alerts in this category. Nice work!" icon={Check} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.slice(0, shown).map((a) => {
              const S = SEVERITY[a.severity];
              return (
                <li key={a.key} className="relative flex items-start gap-3 py-2.5 pr-2 pl-4">
                  <span className={cn("absolute inset-y-2 left-0 w-1 rounded-r", S.bar)} aria-hidden />
                  <S.icon className={cn("mt-0.5 size-4 shrink-0", S.cls)} aria-label={S.label} />
                  <Link href={a.href} className="min-w-0 flex-1 hover:underline">
                    <div className="truncate text-sm font-medium">{a.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{categories[a.category]} · {a.detail}</div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Alert actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => act(a, "done")}><Check /> Mark done</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Snooze</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => act(a, "snooze", 1)}><Clock /> 1 day</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => act(a, "snooze", 3)}><Clock /> 3 days</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setCustom(a)}><Clock /> Custom…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
        {list.length > shown && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
          </Button>
        )}
      </CardContent>

      <Dialog open={!!custom} onOpenChange={(o) => !o && setCustom(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Snooze alert</DialogTitle>
            <DialogDescription className="line-clamp-2">{custom?.title}</DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            <span>Number of days (1–90)</span>
            <Input type="number" min={1} max={90} value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustom(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const d = Math.min(90, Math.max(1, Math.round(Number(customDays) || 1)));
                if (custom) act(custom, "snooze", d);
                setCustom(null);
              }}
            >
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-primary/30 bg-primary/10 text-primary" : "bg-card-solid text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
