"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldNote, NONE } from "@/components/shared/form-fields";
import type { ActionResult } from "@/lib/action-result";
import { formatDateKey, formatMonthKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { createChangeRequestAction, createRetainerMonthAction, decideChangeRequestAction, saveMilestoneAction, saveTargetAction, saveTargetProgressAction } from "@/server/actions/work";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        after?.();
        router.refresh();
      } else setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error);
    });
  return { pending, run, error, setError };
}

type MilestoneRow = { id: string; name: string; dueDate: string | null; paymentPercent: string | null; amount: string | null; status: string; openTasks: number };

export function MilestonesPanel({ projectId, rows, today, canManage }: { projectId: string; rows: MilestoneRow[]; today: string; canManage: boolean }) {
  const { pending, run, error, setError } = useAct();
  const [editing, setEditing] = useState<MilestoneRow | "new" | null>(null);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [percent, setPercent] = useState("");

  const open = (m: MilestoneRow | "new") => {
    setError(undefined);
    setName(m === "new" ? "" : m.name);
    setDue(m === "new" ? "" : (m.dueDate ?? ""));
    setPercent(m === "new" ? "" : (m.paymentPercent ?? ""));
    setEditing(m);
  };
  const save = (completed: boolean, row?: MilestoneRow) =>
    run(
      () =>
        saveMilestoneAction({
          projectId,
          id: row?.id ?? (editing !== "new" && editing ? editing.id : undefined),
          name: row?.name ?? name,
          dueDate: row ? (row.dueDate ?? "") : due,
          paymentPercent: row ? row.paymentPercent : percent,
          completed,
        }),
      () => setEditing(null),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
        {canManage && <Button variant="outline" size="sm" onClick={() => open("new")}><Plus /> Add</Button>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((m) => {
              const done = m.status === "COMPLETED";
              const missed = !done && m.dueDate && m.dueDate < today;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className={cn("font-medium", done && "text-muted-foreground line-through")}>{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.dueDate ? <span className={cn(missed && "font-medium text-tone-red")}>{missed ? "Missed: " : "Due "}{formatDateKey(m.dueDate)}</span> : "No due date"}
                      {m.paymentPercent && ` · ${Number(m.paymentPercent)}% payment`}
                      {m.amount && ` (${m.amount})`}
                      {m.openTasks > 0 && ` · ${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {done && <Badge tone="green">Done</Badge>}
                    {canManage && !done && <Button variant="outline" size="sm" disabled={pending} onClick={() => save(true, m)}><Check /> Mark done</Button>}
                    {canManage && done && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(false, m)}>Reopen</Button>}
                    {canManage && <Button variant="ghost" size="sm" onClick={() => open(m)}>Edit</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && !editing && <FieldNote error={error} />}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing === "new" ? "Add milestone" : "Edit milestone"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="msName">Name</Label><Input id="msName" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="msDue">Due date</Label><Input id="msDue" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="msPct">Payment %</Label><Input id="msPct" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} /></div>
            </div>
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={pending} onClick={() => save(editing !== "new" && editing?.status === "COMPLETED")}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type TargetRow = { id: string; metric: string; unit: string | null; target: string; higherIsBetter: boolean; serviceName: string | null; progress: { month: string; actual: string }[] };

export function TargetsPanel({ projectId, rows, currentMonth, canManage }: { projectId: string; rows: TargetRow[]; currentMonth: string; canManage: boolean }) {
  const { pending, run, error, setError } = useAct();
  const [adding, setAdding] = useState(false);
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [higher, setHigher] = useState(true);
  const [entry, setEntry] = useState<TargetRow | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [actual, setActual] = useState("");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Targets vs actual</CardTitle>
          <CardDescription>Enter the result for each month.</CardDescription>
        </div>
        {canManage && <Button variant="outline" size="sm" onClick={() => { setError(undefined); setMetric(""); setUnit(""); setValue(""); setHigher(true); setAdding(true); }}><Plus /> Add</Button>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No targets yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((t) => {
              const latest = t.progress[0];
              const targetN = Number(t.target);
              const actualN = latest ? Number(latest.actual) : null;
              const met = actualN !== null && (t.higherIsBetter ? actualN >= targetN : actualN <= targetN);
              const pct = actualN === null || targetN === 0 ? 0 : Math.min(100, t.higherIsBetter ? (actualN / targetN) * 100 : (targetN / Math.max(actualN, 0.01)) * 100);
              return (
                <li key={t.id} className="space-y-1.5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{t.metric}</span>
                      {t.serviceName && <span className="ml-1 text-xs text-muted-foreground">{t.serviceName}</span>}
                    </div>
                    <div className="tabular-nums">
                      <span className="font-semibold">{latest ? Number(latest.actual).toLocaleString("en-IN") : "—"}</span>
                      <span className="text-muted-foreground"> / {targetN.toLocaleString("en-IN")}{t.unit && t.unit !== "count" ? ` ${t.unit}` : ""}</span>
                      {met && <Badge tone="green" className="ml-2">Met</Badge>}
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: met ? "var(--chart-3)" : "var(--chart-1)" }} /></div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex flex-wrap gap-x-3">{t.progress.slice(0, 4).map((p) => <span key={p.month} className="tabular-nums">{formatMonthKey(p.month, true)}: {Number(p.actual).toLocaleString("en-IN")}</span>)}</span>
                    {canManage && <Button variant="ghost" size="sm" onClick={() => { setError(undefined); setEntry(t); setMonth(currentMonth); setActual(""); }}>Enter result</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add target</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="tMetric">What are you measuring?</Label><Input id="tMetric" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. Followers, Leads, CPL" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="tValue">Target</Label><Input id="tValue" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="tUnit">Unit</Label><Input id="tUnit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="count, %, ₹" /></div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="tHigher">Higher is better</Label>
              <Switch id="tHigher" checked={higher} onCheckedChange={setHigher} />
            </div>
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={pending} onClick={() => run(() => saveTargetAction(null, { projectId, serviceId: "", metric, unit, targetValue: value, higherIsBetter: higher }), () => setAdding(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!entry} onOpenChange={(o) => !o && setEntry(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter result</DialogTitle>
            <DialogDescription>{entry?.metric}. Entering a month again corrects it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pMonth">Month</Label><Input id="pMonth" type="month" max={currentMonth} value={month} onChange={(e) => setMonth(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pActual">Actual</Label><Input id="pActual" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} /></div>
          </div>
          <FieldNote error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntry(null)}>Cancel</Button>
            <Button disabled={pending} onClick={() => entry && run(() => saveTargetProgressAction(projectId, { targetId: entry.id, month, actualValue: actual, note: "" }), () => setEntry(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type ChangeRow = { id: string; description: string; estimate: string; isBillable: boolean; status: string; deliverable: string | null; created: string };

export function ChangeRequestsPanel({ projectId, rows, deliverables }: { projectId: string; rows: ChangeRow[]; deliverables: { value: string; label: string }[] }) {
  const { pending, run, error, setError } = useAct();
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState("");
  const [estimate, setEstimate] = useState("");
  const [billable, setBillable] = useState(true);
  const [deliverable, setDeliverable] = useState("");

  const tone = (s: string) => (s === "APPROVED" ? "green" : s === "REJECTED" ? "red" : s === "INVOICED" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";
  const label = (s: string) => ({ PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", INVOICED: "Invoiced" })[s] ?? s;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Change requests</CardTitle>
          <CardDescription>Extra revisions or work outside the offer. Approved billable requests can go on the next invoice (Phase 7).</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setError(undefined); setDescription(""); setEstimate(""); setBillable(true); setDeliverable(""); setAdding(true); }}><Plus /> Log request</Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No change requests.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words whitespace-pre-wrap">{c.description}</p>
                  <div className="text-xs text-muted-foreground">
                    {c.created} · {c.estimate} · {c.isBillable ? "Billable" : "Not billable"}{c.deliverable && ` · ${c.deliverable}`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge tone={tone(c.status)}>{label(c.status)}</Badge>
                  {c.status === "PENDING" && (
                    <>
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => decideChangeRequestAction(c.id, "APPROVED", projectId))}><Check /> Approve</Button>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => decideChangeRequestAction(c.id, "REJECTED", projectId))}><X /> Reject</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log a change request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="crDesc">What&apos;s being asked for?</Label><Textarea id="crDesc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="crEstimate">Estimate (₹, excl. GST)</Label><Input id="crEstimate" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></div>
            {deliverables.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="crDeliverable">Deliverable</Label>
                <Select value={deliverable || NONE} onValueChange={(v) => setDeliverable(v === NONE ? "" : v)}>
                  <SelectTrigger id="crDeliverable" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {deliverables.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="crBillable">Billable</Label>
              <Switch id="crBillable" checked={billable} onCheckedChange={setBillable} />
            </div>
            <FieldNote error={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={pending} onClick={() => run(() => createChangeRequestAction({ projectId, deliverableId: deliverable, description, estimate, isBillable: billable }), () => setAdding(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function RetainerMonthButton({ projectId, month, label }: { projectId: string; month: string; label: string }) {
  const { pending, run, error } = useAct();
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => createRetainerMonthAction(projectId, month))}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} {label}
      </Button>
      <FieldNote error={error} />
    </div>
  );
}
