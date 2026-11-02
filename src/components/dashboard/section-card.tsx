"use client";

import { useState } from "react";
import { Table2, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type TableData = { columns: string[]; rows: (string | number)[][] };

/** Card wrapper for a chart with an accessible "view as table" toggle. */
export function SectionCard({
  title,
  description,
  table,
  action,
  children,
  className,
  id,
}: {
  title: string;
  description?: string;
  table?: TableData;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("min-w-0", className)} id={id}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {table && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAsTable((v) => !v)}
              aria-label={asTable ? "Show chart" : "Show as table"}
              title={asTable ? "Show chart" : "Show as table"}
            >
              {asTable ? <BarChart3 /> : <Table2 />}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {asTable && table ? (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((c, i) => (
                    <TableHead key={c} className={i ? "text-right" : ""}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((r, i) => (
                  <TableRow key={i}>
                    {r.map((v, j) => (
                      <TableCell key={j} className={j ? "text-right tabular-nums" : ""}>{v}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
