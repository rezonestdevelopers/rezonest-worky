import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { EXPORT_TABLES } from "@/server/services/data-export";

const EVERYTHING = "/api/export/data/all";

export const metadata: Metadata = { title: "Data export" };

export default async function DataExportPage() {
  await requirePermission("settings.manage");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Data export"
        description="Your data, whenever you want a copy. Password hashes and security tokens are never included."
        actions={<Button size="sm" asChild><a href={EVERYTHING}><Download /> Everything (Excel)</a></Button>}
      />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>One table at a time</CardTitle>
            <CardDescription>Uploaded files aren&apos;t in these. They&apos;re in file storage, and the Documents table lists them. Each download is recorded.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-5">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXPORT_TABLES.map((t) => (
                <TableRow key={t.key}>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild><a href={`/api/export/data/${t.key}`} aria-label={`${t.label} as Excel`}>Excel</a></Button>
                      <Button variant="ghost" size="sm" asChild><a href={`/api/export/data/${t.key}?format=csv`} aria-label={`${t.label} as CSV`}>CSV</a></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
