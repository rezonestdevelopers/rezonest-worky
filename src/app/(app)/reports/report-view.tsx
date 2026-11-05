import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCell, type ReportDoc, type ReportSection } from "@/lib/reports";

const alignRight = (kind?: string) => kind === "money" || kind === "number" || kind === "percent";

function Section({ section }: { section: ReportSection }) {
  const prose = section.columns.length === 1 && !section.columns[0].label;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{section.title}</CardTitle>
          {section.note && <CardDescription>{section.note}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className={prose ? undefined : "px-0 sm:px-5"}>
        {prose ? (
          <p className="text-sm whitespace-pre-wrap">{String(section.rows[0]?.[0] ?? "")}</p>
        ) : section.rows.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground sm:px-0">{section.empty ?? "Nothing to show."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {section.columns.map((c) => <TableHead key={c.label} className={alignRight(c.kind) ? "text-right" : undefined}>{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map((row, n) => (
                <TableRow key={n}>
                  {row.map((v, i) => {
                    const kind = section.columns[i]?.kind;
                    return <TableCell key={i} className={alignRight(kind) ? "text-right tabular-nums" : "max-w-72 truncate"} title={typeof v === "string" ? v : undefined}>{formatCell(kind, v)}</TableCell>;
                  })}
                </TableRow>
              ))}
              {section.total && (
                <TableRow className="font-semibold hover:bg-transparent">
                  {section.total.map((v, i) => {
                    const kind = section.columns[i]?.kind;
                    return <TableCell key={i} className={alignRight(kind) ? "text-right tabular-nums" : undefined}>{v === null ? "" : formatCell(kind, v)}</TableCell>;
                  })}
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Shows any report. The PDF and Excel come from the same cells, so all three match. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <div className="space-y-4">
      {doc.summary && doc.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="report-summary">
          {doc.summary.map((s) => (
            <Card key={s.label} className="gap-1 py-4">
              <CardContent className="px-4">
                <div className="truncate text-xs text-muted-foreground">{s.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {doc.sections.map((s) => <Section key={s.title} section={s} />)}
    </div>
  );
}

export function DownloadButtons({ kind, query }: { kind: string; query: string }) {
  const href = (format: string) => `/api/reports/${kind}?${query}${query ? "&" : ""}format=${format}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" asChild><a href={href("pdf")} target="_blank" rel="noopener noreferrer"><FileText /> PDF</a></Button>
      <Button variant="outline" size="sm" asChild><a href={href("xlsx")}><Download /> Excel</a></Button>
    </div>
  );
}
