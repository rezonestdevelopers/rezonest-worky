import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { TEMPLATE_DEFINITIONS } from "@/lib/email-templates";
import { SendDigestButton } from "./send-digest-button";

export const metadata: Metadata = { title: "Email templates" };

export default async function EmailTemplatesPage() {
  await requirePermission("settings.manage");
  const saved = await db.emailTemplate.findMany();
  return (
    <div className="space-y-4">
      <PageHeader title="Email templates" description="The words in every message the app sends. Payment reminders only ever go when you click." actions={<SendDigestButton />} />
      <div className="glass overflow-hidden rounded-xl border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead>Template</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TEMPLATE_DEFINITIONS.map((t) => {
              const row = saved.find((s) => s.key === t.key);
              const edited = !!row && (row.subject !== t.subject || row.body !== t.body || row.whatsapp !== t.whatsapp);
              return (
                <TableRow key={t.key}>
                  <TableCell className="font-medium"><Link href={`/settings/emails/${t.key}`} className="hover:underline">{t.name}</Link></TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">{t.when}</TableCell>
                  <TableCell>{t.whatsapp === null ? "No" : "Yes"}</TableCell>
                  <TableCell>{edited ? <Badge tone="blue">Edited</Badge> : <Badge tone="grey">Original</Badge>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
