"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { commitImportAction, previewImportAction, type PreviewRow } from "@/server/actions/imports";

type Kind = "leads" | "clients";

/** Upload → preview (with errors and duplicates) → confirm. Nothing is saved before the last step. */
export function ImportWizard({ kind, nameField, secondaryField }: { kind: Kind; nameField: string; secondaryField: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<Set<number>>(new Set());

  const counts = useMemo(() => {
    const list = rows ?? [];
    const withErrors = list.filter((r) => r.errors.length).length;
    const duplicates = list.filter((r) => !r.errors.length && r.duplicates.length).length;
    return { total: list.length, withErrors, duplicates, ready: list.length - withErrors - duplicates, allowed: allowed.size };
  }, [rows, allowed]);
  const toImport = counts.ready + counts.allowed;

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    setError(null);
    setFileName(file.name);
    start(async () => {
      const res = await previewImportAction(fd);
      if (input.current) input.current.value = "";
      if (res.ok) {
        setRows(res.rows);
        setIgnored(res.ignoredColumns);
        setAllowed(new Set());
      } else {
        setRows(null);
        setError(res.error);
      }
    });
  };

  const commit = () =>
    start(async () => {
      const res = await commitImportAction({
        kind,
        rows: (rows ?? []).map((r) => ({ rowNumber: r.rowNumber, values: r.values })),
        allowDuplicateRows: Array.from(allowed),
      });
      if (res.ok) {
        toast.success(res.message ?? "Imported");
        router.push(`/${kind}`);
      } else {
        toast.error(res.error);
      }
    });

  const toggle = (rowNumber: number) =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Choose your file</CardTitle>
            <CardDescription>Excel (.xlsx) or CSV, up to 5 MB and 2,000 rows. The first row must be the column headings.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            aria-label="Import file"
            data-testid="import-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Upload />} {rows ? "Choose another file" : "Choose file"}
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/import/template?kind=${kind}`} download><Download /> Download template</a>
          </Button>
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          {error && (
            <p role="alert" className="flex w-full items-start gap-2 rounded-md border border-tone-red/30 bg-tone-red/10 px-3 py-2 text-sm text-tone-red">
              <XCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </CardContent>
      </Card>

      {rows && (
        <Card>
          <CardHeader className="flex-col gap-3 sm:flex-row">
            <div>
              <CardTitle>2. Check the preview</CardTitle>
              <CardDescription>Nothing has been saved yet.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green"><CheckCircle2 /> {counts.ready} ready</Badge>
              {counts.duplicates > 0 && <Badge tone="amber"><AlertTriangle /> {counts.duplicates} possible duplicate{counts.duplicates === 1 ? "" : "s"}</Badge>}
              {counts.withErrors > 0 && <Badge tone="red"><XCircle /> {counts.withErrors} with errors</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-0 sm:px-5">
            {ignored.length > 0 && (
              <p className="px-5 text-xs text-muted-foreground sm:px-0">These columns weren&apos;t recognised and will be ignored: {ignored.join(", ")}.</p>
            )}
            <div className="max-h-[60vh] overflow-auto border-y sm:rounded-lg sm:border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone / email</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const hasError = r.errors.length > 0;
                    const isDuplicate = !hasError && r.duplicates.length > 0;
                    return (
                      <TableRow key={r.rowNumber}>
                        <TableCell className="align-top tabular-nums">{r.rowNumber}</TableCell>
                        <TableCell className="align-top">
                          <div className="max-w-56 truncate font-medium">{r.values[nameField] || "—"}</div>
                          <div className="max-w-56 truncate text-xs text-muted-foreground">{r.values[secondaryField]}</div>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          <div>{r.values.phone}</div>
                          <div className="text-muted-foreground">{r.values.email}</div>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <div className="min-w-56 space-y-1 text-xs">
                            {!hasError && !isDuplicate && <div className="flex items-center gap-1 text-tone-green"><CheckCircle2 className="size-3.5" /> Ready</div>}
                            {r.errors.map((m, i) => <div key={i} className="flex items-start gap-1 text-tone-red"><XCircle className="mt-0.5 size-3.5 shrink-0" /> {m}</div>)}
                            {isDuplicate && (
                              <label className="flex items-start gap-2">
                                <input type="checkbox" className="mt-0.5" checked={allowed.has(r.rowNumber)} onChange={() => toggle(r.rowNumber)} aria-label={`Import row ${r.rowNumber} anyway`} />
                                <span>
                                  Same {r.duplicates[0].reasons.join(", ")} as <strong>{r.duplicates[0].name}</strong>
                                  {r.duplicates.length > 1 && ` and ${r.duplicates.length - 1} more`}. Tick to import anyway.
                                </span>
                              </label>
                            )}
                            {r.warnings.map((m, i) => <div key={i} className="flex items-start gap-1 text-muted-foreground"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {m}</div>)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-0">
              <p className="text-sm text-muted-foreground">
                {toImport} of {counts.total} row{counts.total === 1 ? "" : "s"} will be imported. The rest are skipped.
              </p>
              <Button onClick={commit} disabled={pending || toImport === 0}>
                {pending && <Loader2 className="animate-spin" />} Import {toImport} {kind === "leads" ? "lead" : "client"}{toImport === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
