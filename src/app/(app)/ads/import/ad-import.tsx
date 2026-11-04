"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateKey } from "@/lib/dates";
import { formatINR, formatNumberIN } from "@/lib/money/format";
import { commitAdImportAction, previewAdImportAction, type AdPreview } from "@/server/actions/delivery";

type Preview = Extract<AdPreview, { ok: true }>;

/** Choose client → upload → check the preview → confirm. Nothing is saved before the last step. */
export function AdImport({ clients, defaultClient }: { clients: { value: string; label: string }[]; defaultClient: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(defaultClient);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ready = preview?.analysed.filter((r) => !r.errors.length).length ?? 0;
  const refused = (preview?.analysed.length ?? 0) - ready;

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("file", file);
    setError(null);
    setFileName(file.name);
    start(async () => {
      const res = await previewAdImportAction(fd);
      if (input.current) input.current.value = "";
      if (res.ok) setPreview(res);
      else {
        setPreview(null);
        setError(res.error);
      }
    });
  };

  const commit = () =>
    start(async () => {
      if (!preview) return;
      const res = await commitAdImportAction({ clientId, rows: preview.rows, columns: preview.columns });
      if (res.ok) {
        toast.success(res.message ?? "Added");
        router.push("/ads");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Choose the client and report</CardTitle>
            <CardDescription>
              CSV or Excel, up to 5 MB. It needs Campaign name, Reporting starts and Amount spent (INR). Reporting ends, Impressions, Link clicks, Leads and Purchases conversion value are read if present. Campaign names must match yours.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:w-72">
            <Label htmlFor="adClient">Client</Label>
            <Select value={clientId} onValueChange={(v) => { setClientId(v); setPreview(null); }}>
              <SelectTrigger id="adClient" className="w-full"><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            aria-label="Report file"
            data-testid="ad-report-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={pending || !clientId}>
            {pending ? <Loader2 className="animate-spin" /> : <Upload />} {preview ? "Choose another file" : "Choose file"}
          </Button>
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        </CardContent>
        {clients.length === 0 && <CardContent><p className="text-sm text-muted-foreground">No client has a campaign yet. Add a campaign first.</p></CardContent>}
        {error && (
          <CardContent>
            <p role="alert" className="flex items-start gap-2 rounded-md border border-tone-red/30 bg-tone-red/10 px-3 py-2 text-sm text-tone-red"><XCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>
          </CardContent>
        )}
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex-col gap-3 sm:flex-row">
            <div>
              <CardTitle>2. Check the preview</CardTitle>
              <CardDescription>Nothing has been saved yet.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green"><CheckCircle2 /> {ready} ready</Badge>
              {refused > 0 && <Badge tone="red"><XCircle /> {refused} can&apos;t be added</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-0 sm:px-5">
            {preview.leadsFromResults && (
              <p className="flex items-start gap-2 px-5 text-xs text-muted-foreground sm:px-0"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> No Leads column was found, so Results is being counted as leads. Check that&apos;s right for these campaigns.</p>
            )}
            {preview.ignored.length > 0 && <p className="px-5 text-xs text-muted-foreground sm:px-0">Not used: {preview.ignored.join(", ")}.</p>}
            <div className="max-h-[60vh] overflow-auto border-y sm:rounded-lg sm:border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Row</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.analysed.map((r) => (
                    <TableRow key={r.rowNumber}>
                      <TableCell className="align-top tabular-nums">{r.rowNumber}</TableCell>
                      <TableCell className="max-w-56 truncate align-top font-medium">{r.campaign || "—"}</TableCell>
                      <TableCell className="align-top text-xs tabular-nums">{r.periodStart ? formatDateKey(r.periodStart) : "—"}{r.periodEnd && r.periodEnd !== r.periodStart ? ` to ${formatDateKey(r.periodEnd)}` : ""}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">{formatINR(r.spend)}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">{formatNumberIN(r.clicks)}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">{formatNumberIN(r.leads)}</TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div className="min-w-48 space-y-1 text-xs">
                          {r.errors.length === 0 && <div className="flex items-center gap-1 text-tone-green"><CheckCircle2 className="size-3.5" /> Ready</div>}
                          {r.errors.map((m, i) => <div key={i} className="flex items-start gap-1 text-tone-red"><XCircle className="mt-0.5 size-3.5 shrink-0" /> {m}</div>)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-0">
              <p className="text-sm text-muted-foreground">{ready} of {preview.analysed.length} row{preview.analysed.length === 1 ? "" : "s"} will be added. The rest are skipped.</p>
              <Button onClick={commit} disabled={pending || ready === 0}>{pending && <Loader2 className="animate-spin" />} Add {ready} row{ready === 1 ? "" : "s"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
