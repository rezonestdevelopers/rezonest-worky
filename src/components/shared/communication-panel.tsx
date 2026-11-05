"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FieldNote } from "@/components/shared/form-fields";
import { formatDateKey } from "@/lib/dates";
import { COMMUNICATION_TYPES } from "@/lib/validators/expense";
import { archiveCommunicationAction, saveCommunicationAction } from "@/server/actions/expenses";

export type CommunicationRow = { id: string; type: string; date: string; summary: string; nextAction: string | null; nextActionDate: string | null };
const LABEL: Record<string, string> = { CALL: "Call", MEETING: "Meeting", WHATSAPP: "WhatsApp", EMAIL: "Email", OTHER: "Other" };

/** Calls, meetings and messages with one client or lead. A next action with a date becomes a reminder. */
export function CommunicationPanel({ clientId, leadId, rows, today }: { clientId?: string; leadId?: string; rows: CommunicationRow[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CommunicationRow | "new" | null>(null);
  const [type, setType] = useState("CALL");
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const open = (row: CommunicationRow | "new") => {
    setErrors({});
    setError(undefined);
    setType(row === "new" ? "CALL" : row.type);
    setDate(row === "new" ? today : row.date);
    setSummary(row === "new" ? "" : row.summary);
    setNextAction(row === "new" ? "" : (row.nextAction ?? ""));
    setNextDate(row === "new" ? "" : (row.nextActionDate ?? ""));
    setEditing(row);
  };
  const save = () =>
    start(async () => {
      setErrors({});
      setError(undefined);
      const res = await saveCommunicationAction(editing && editing !== "new" ? editing.id : null, { clientId: clientId ?? "", leadId: leadId ?? "", type: type as (typeof COMMUNICATION_TYPES)[number], date, summary, nextAction, nextActionDate: nextDate });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error);
        setErrors(res.fieldErrors ?? {});
      }
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Communication log</CardTitle>
          <CardDescription>Calls, meetings and messages. A next action with a date becomes a reminder.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => open("new")}><Plus /> Log</Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y" data-testid="communication-list">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="text-xs text-muted-foreground">{formatDateKey(c.date)} · {LABEL[c.type] ?? c.type}</div>
                  <p className="mt-0.5 break-words whitespace-pre-wrap">{c.summary}</p>
                  {c.nextAction && <p className="mt-1 text-xs font-medium">Next: {c.nextAction}{c.nextActionDate && ` · ${formatDateKey(c.nextActionDate)}`}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Edit entry from ${formatDateKey(c.date)}`} onClick={() => open(c)}><Pencil /> Edit</Button>
                  <ConfirmButton variant="ghost" label="Archive" icon={<Archive />} ariaLabel={`Archive entry from ${formatDateKey(c.date)}`} title="Archive this entry?" description="It's hidden from this log, and its reminder stops. Nothing is permanently deleted." confirmLabel="Archive" action={() => archiveCommunicationAction(c.id, clientId ?? null, leadId ?? null)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing === "new" ? "Log a conversation" : "Edit entry"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="commType">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="commType" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMUNICATION_TYPES.map((t) => <SelectItem key={t} value={t}>{LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commDate">Date</Label>
                <Input id="commDate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
                <FieldNote error={errors.date} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commSummary">What was said</Label>
              <Textarea id="commSummary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
              <FieldNote error={errors.summary} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="space-y-1.5">
                <Label htmlFor="commNext">Next action</Label>
                <Input id="commNext" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
                <FieldNote error={errors.nextAction} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commNextDate">Remind me on</Label>
                <Input id="commNextDate" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                <FieldNote error={errors.nextActionDate} />
              </div>
            </div>
            {error && !Object.keys(errors).length && <FieldNote error={error} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
