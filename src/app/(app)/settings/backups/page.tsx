import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { formatDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatFileSize } from "@/lib/file-types";
import { BACKUP_KEEP_DAYS, listBackups } from "@/server/services/backups";
import { BackupNowButton } from "./backup-now";

export const metadata: Metadata = { title: "Backups" };

export default async function BackupsPage() {
  await requirePermission("settings.manage");
  const runs = await listBackups(db);
  const onThisMachine = process.env.STORAGE_DRIVER !== "s3";
  return (
    <div className="space-y-4">
      <PageHeader title="Backups" description={`A copy of the whole database, once a day. The last ${BACKUP_KEEP_DAYS} days are kept.`} actions={<BackupNowButton />} />
      {onThisMachine && (
        <p className="rounded-lg border border-tone-amber/40 bg-tone-amber/10 p-3 text-sm" data-testid="backup-warning">
          These copies are on this computer, so they won&apos;t survive if it fails. Download one now and then, and keep it somewhere else, until cloud storage is set up when you go live.
        </p>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent backups</CardTitle>
            <CardDescription>A backup holds everything, so keep any download safe. The README has the steps to restore one.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-5">
          {runs.length === 0 ? (
            <EmptyState title="No backups yet" hint="Click Back up now to make the first one." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDateKey(r.day)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {r.deletedAt ? <Badge tone="grey">Removed after {BACKUP_KEEP_DAYS} days</Badge> : r.status === "DONE" ? <Badge tone="green">Done</Badge> : r.status === "RUNNING" ? <Badge tone="amber">Running</Badge> : <Badge tone="red">Failed</Badge>}
                      {r.status === "FAILED" && r.error && <p className="mt-1 max-w-md text-xs break-words text-muted-foreground">{r.error}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.sizeBytes ? formatFileSize(r.sizeBytes) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "DONE" && !r.deletedAt ? <Button variant="ghost" size="sm" asChild><a href={`/api/backups/${r.id}`} aria-label={`Download backup of ${formatDateKey(r.day)}`}><Download /> Download</a></Button> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
