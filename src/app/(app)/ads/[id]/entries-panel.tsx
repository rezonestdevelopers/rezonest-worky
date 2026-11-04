"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FieldNote } from "@/components/shared/form-fields";
import { adMetrics, totalEntries } from "@/lib/ad-metrics";
import { addDaysKey, formatDateKey } from "@/lib/dates";
import { formatINR, formatNumberIN } from "@/lib/money/format";
import { removeSpendEntryAction, saveSpendEntryAction } from "@/server/actions/delivery";

type Entry = { id: string; periodStart: string; periodEnd: string; spend: string; impressions: number; clicks: number; leads: number; conversionValue: string; source: string };

const BLANK = { periodStart: "", periodEnd: "", spend: "", impressions: "", clicks: "", leads: "", conversionValue: "" };

export function EntriesPanel({ campaignId, entries, readOnly, today }: { campaignId: string; entries: Entry[]; readOnly: boolean; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [values, setValues] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string>();

  const open = (e: Entry | "new") => {
    setErrors({});
    setProblem(undefined);
    if (e === "new") {
      // Continues from the last entry, ending today at the latest.
      const next = entries[0] ? addDaysKey(entries[0].periodEnd, 1) : addDaysKey(today, -6);
      const from = next > today ? today : next;
      const to = addDaysKey(from, 6) > today ? today : addDaysKey(from, 6);
      setValues({ ...BLANK, periodStart: from, periodEnd: to });
    } else {
      setValues({ periodStart: e.periodStart, periodEnd: e.periodEnd, spend: e.spend, impressions: String(e.impressions), clicks: String(e.clicks), leads: String(e.leads), conversionValue: e.conversionValue === "0" ? "" : e.conversionValue });
    }
    setEditing(e);
  };

  const save = () =>
    start(async () => {
      setErrors({});
      setProblem(undefined);
      const res = await saveSpendEntryAction(editing !== "new" && editing ? editing.id : null, { campaignId, ...values, impressions: Number(values.impressions), clicks: Number(values.clicks), leads: Number(values.leads) });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        setEditing(null);
        router.refresh();
      } else {
        setProblem(res.fieldErrors ? undefined : res.error);
        setErrors(res.fieldErrors ?? {});
      }
    });

  const field = (key: keyof typeof BLANK, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`entry-${key}`}>{label}</Label>
      <Input id={`entry-${key}`} aria-invalid={!!errors[key]} value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} {...props} />
      <FieldNote error={errors[key]} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Spend and results</CardTitle>
          <CardDescription>Daily or weekly, as you prefer. Dates can&apos;t overlap, so nothing counts twice.</CardDescription>
        </div>
        {!readOnly && <Button variant="outline" size="sm" onClick={() => open("new")}><Plus /> Add results</Button>}
      </CardHeader>
      <CardContent className="px-0 sm:px-5">
        {entries.length === 0 ? (
          <EmptyState title="No results yet" hint="Add them here, or upload a report from Ads Manager." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  {!readOnly && <TableHead><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const m = adMetrics(totalEntries([e]), 0);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="tabular-nums">
                        {formatDateKey(e.periodStart)}{e.periodEnd !== e.periodStart && ` to ${formatDateKey(e.periodEnd)}`}
                        {e.source === "csv" && <span className="ml-2 text-xs text-muted-foreground">Uploaded</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(e.spend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumberIN(e.impressions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumberIN(e.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.ctr === null ? "—" : `${m.ctr}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumberIN(e.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.cpl ? formatINR(m.cpl) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.roas === null ? "—" : `${m.roas}x`}</TableCell>
                      {!readOnly && (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${e.periodStart}`} onClick={() => open(e)}><Pencil /></Button>
                          <ConfirmButton
                            label="Remove"
                            title="Remove these results?"
                            description="They stop counting towards this campaign's totals. The change is kept in the activity log."
                            confirmLabel="Remove"
                            action={removeSpendEntryAction.bind(null, e.id, campaignId)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add results" : "Edit results"}</DialogTitle>
            <DialogDescription>CTR, CPL and ROAS are worked out for you.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {field("periodStart", "From", { type: "date", max: today })}
            {field("periodEnd", "To", { type: "date", max: today })}
            {field("spend", "Amount spent (₹)", { inputMode: "decimal" })}
            {field("impressions", "Impressions", { inputMode: "numeric" })}
            {field("clicks", "Clicks", { inputMode: "numeric" })}
            {field("leads", "Leads", { inputMode: "numeric" })}
            {field("conversionValue", "Sales value (₹)", { inputMode: "decimal", placeholder: "For ROAS" })}
          </div>
          <FieldNote error={problem} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
